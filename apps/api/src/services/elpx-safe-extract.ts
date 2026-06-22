import { rm, readdir, lstat, realpath } from "node:fs/promises";
import path from "node:path";

/**
 * Apertura segura de archivos .elpx (paquetes ZIP de eXeLearning).
 *
 * Un .elpx es un ZIP con HTML/JS/recursos de autor no confiable. Antes de
 * extraerlo en disco hay que defenderse de tres familias de ataque clásicas
 * sobre archivos comprimidos:
 *
 *   1. Zip slip / path traversal: una entrada con nombre `../../etc/passwd`,
 *      ruta absoluta o esquema `file://` puede escribir fuera del destino.
 *   2. Symlinks maliciosos: una entrada symlink que apunte fuera del destino
 *      convierte escrituras/lecturas posteriores en operaciones de ruta
 *      arbitraria.
 *   3. Zip bomb: un archivo pequeño que descomprime a gigabytes (o miles de
 *      entradas) y agota el disco.
 *
 * Este módulo porta a TypeScript las dos defensas del plugin de Moodle
 * `mod_exelearning` (`classes/local/zip_utils.php`: `is_unsafe_zip_entry` y
 * `assert_extraction_contained`) y añade inspección previa del directorio
 * central del ZIP para aplicar límites anti zip-bomb y rechazar symlinks ANTES
 * de extraer. Ver ADR-0026.
 */

export type ElpxExtractLimits = {
  /** Número máximo de entradas en el ZIP. */
  maxEntries: number;
  /** Tamaño total descomprimido máximo, en bytes. */
  maxTotalUncompressed: number;
  /** Ratio máximo total descomprimido/comprimido (guarda secundaria). */
  maxCompressionRatio: number;
};

export const DEFAULT_ELPX_EXTRACT_LIMITS: ElpxExtractLimits = {
  maxEntries: 5_000,
  maxTotalUncompressed: 500 * 1024 * 1024, // 500 MiB
  maxCompressionRatio: 500,
};

export type ZipEntryInfo = {
  name: string;
  uncompressedSize: number;
  compressedSize: number;
  isSymlink: boolean;
};

const EOCD_SIGNATURE = 0x06054b50; // PK\x05\x06
const CDFH_SIGNATURE = 0x02014b50; // PK\x01\x02
const ZIP64_SENTINEL = 0xffffffff;
const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;

/**
 * Entradas que nunca deben extraerse: nombre vacío, backslash (rutas Windows),
 * ruta absoluta, esquema `scheme://`, o traversal `..`.
 *
 * Port directo de `zip_utils.php::is_unsafe_zip_entry`.
 */
export function isUnsafeZipEntry(name: string): boolean {
  if (name === "") return true;
  if (name.includes("\\")) return true;
  if (name.startsWith("/")) return true;
  if (/^[a-zA-Z]+:\/\//.test(name)) return true;
  if (/(^|\/)\.\.(\/|$)/.test(name)) return true;
  return false;
}

function findEocdOffset(buf: Buffer): number {
  // El EOCD está al final; su comentario puede ocupar hasta 65535 bytes, así
  // que escaneamos hacia atrás buscando la firma. El mínimo EOCD son 22 bytes.
  const minOffset = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      return i;
    }
  }
  return -1;
}

/**
 * Lee el directorio central del ZIP sin descomprimir nada. Devuelve, por cada
 * entrada, su nombre, tamaños y si es un symlink (modo Unix S_IFLNK en los
 * atributos externos). Lanza error si el ZIP está corrupto o usa ZIP64
 * (eXeLearning no genera ZIP64; lo tratamos como no soportado, fail-closed).
 */
export function readZipCentralDirectory(buf: Buffer): ZipEntryInfo[] {
  if (buf.length < 22 || buf.readUInt16LE(0) !== 0x4b50) {
    throw new Error("El archivo no es un ZIP válido");
  }

  const eocd = findEocdOffset(buf);
  if (eocd < 0) {
    throw new Error("El archivo no es un .elpx válido (ZIP sin directorio central)");
  }

  const totalEntries = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (offset === ZIP64_SENTINEL || totalEntries === 0xffff) {
    throw new Error("Archivo ZIP64 no soportado");
  }

  const entries: ZipEntryInfo[] = [];
  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CDFH_SIGNATURE) {
      throw new Error("Directorio central del ZIP corrupto");
    }

    const versionMadeBy = buf.readUInt16LE(offset + 4);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const externalAttr = buf.readUInt32LE(offset + 38);

    if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL) {
      throw new Error("Archivo ZIP64 no soportado");
    }

    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);

    // El host está en el byte alto de "version made by"; 3 = Unix. Solo en ese
    // caso los 16 bits altos de los atributos externos llevan el modo Unix.
    const hostSystem = versionMadeBy >> 8;
    const unixMode = (externalAttr >>> 16) & 0xffff;
    const isSymlink = hostSystem === 3 && (unixMode & S_IFMT) === S_IFLNK;

    entries.push({ name, uncompressedSize, compressedSize, isSymlink });

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Inspecciona el manifiesto del .elpx y rechaza cualquier archivo peligroso
 * (nombre inseguro, symlink) o que exceda los límites anti zip-bomb, ANTES de
 * tocar el disco. Devuelve las entradas válidas si todo pasa.
 */
export function inspectZipEntries(
  buf: Buffer,
  limits: ElpxExtractLimits = DEFAULT_ELPX_EXTRACT_LIMITS,
): ZipEntryInfo[] {
  const entries = readZipCentralDirectory(buf);

  if (entries.length > limits.maxEntries) {
    throw new Error(
      `El .elpx contiene demasiadas entradas (${entries.length} > ${limits.maxEntries})`,
    );
  }

  let totalUncompressed = 0;
  let totalCompressed = 0;

  for (const entry of entries) {
    if (isUnsafeZipEntry(entry.name)) {
      throw new Error(`Entrada de ZIP no segura: ${entry.name}`);
    }
    if (entry.isSymlink) {
      throw new Error(`El .elpx contiene un enlace simbólico: ${entry.name}`);
    }
    totalUncompressed += entry.uncompressedSize;
    totalCompressed += entry.compressedSize;
  }

  if (totalUncompressed > limits.maxTotalUncompressed) {
    throw new Error(
      `El .elpx descomprimido excede el tamaño máximo permitido (${totalUncompressed} > ${limits.maxTotalUncompressed} bytes)`,
    );
  }

  if (
    totalCompressed > 0 &&
    totalUncompressed / totalCompressed > limits.maxCompressionRatio
  ) {
    throw new Error(
      `Ratio de compresión sospechoso (posible zip bomb): ${Math.round(totalUncompressed / totalCompressed)} > ${limits.maxCompressionRatio}`,
    );
  }

  return entries;
}

/**
 * Verifica que una extracción quedó completamente dentro de `dir`: ningún
 * symlink (podría apuntar fuera) y la ruta real de cada entrada contenida en la
 * ruta real de `dir`. Defensa en profundidad tras las comprobaciones de nombre.
 *
 * Port de `zip_utils.php::assert_extraction_contained`.
 */
export async function assertExtractionContained(dir: string): Promise<void> {
  const root = await realpath(dir);

  async function walk(current: string): Promise<void> {
    const dirents = await readdir(current, { withFileTypes: true });
    for (const dirent of dirents) {
      const full = path.join(current, dirent.name);

      // No seguir symlinks: inspeccionamos el enlace, no su destino.
      const stats = await lstat(full);
      if (stats.isSymbolicLink()) {
        throw new Error(`Extracción insegura: enlace simbólico en ${full}`);
      }

      const real = await realpath(full);
      const contained = real === root || real.startsWith(root + path.sep);
      if (!contained) {
        throw new Error(`Extracción insegura: ruta fuera del destino en ${full}`);
      }

      if (stats.isDirectory()) {
        await walk(full);
      }
    }
  }

  await walk(dir);
}

/**
 * Extrae un .elpx de forma segura en `extractPath`:
 *   1. Inspecciona el directorio central y rechaza entradas peligrosas y bombas.
 *   2. Extrae con `unzip`.
 *   3. Verifica que lo materializado quedó contenido (anti-symlink/escape).
 *
 * Ante cualquier fallo hace rollback (borra `extractPath`) para no dejar una
 * extracción parcial o insegura en disco.
 */
export async function safeExtractElpx(
  filePath: string,
  extractPath: string,
  limits: ElpxExtractLimits = DEFAULT_ELPX_EXTRACT_LIMITS,
): Promise<void> {
  const buf = await Bun.file(filePath).bytes();

  try {
    // Validación previa: lanza antes de extraer si algo es peligroso.
    inspectZipEntries(Buffer.from(buf), limits);

    const proc = Bun.spawn(["unzip", "-o", filePath, "-d", extractPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error("Error al extraer el archivo .elpx");
    }

    // Defensa post-extracción: nada pudo escapar del destino.
    await assertExtractionContained(extractPath);
  } catch (error) {
    await rm(extractPath, { recursive: true, force: true });
    throw error;
  }
}
