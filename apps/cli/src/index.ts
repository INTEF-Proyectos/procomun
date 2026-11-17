import { applySuccessfulCliExit } from "./exit-code.ts";

type CliHandler = (args: string[]) => Promise<void>;

export const CLI_COMMANDS = [
	"user:create",
	"user:list",
	"seed",
	"seed:resources",
	"fts:reindex",
	"import:legacy-procomun",
	"import:legacy-users",
	"elpx:screenshots",
	"elpx:thumbnails",
	"catalog:area-keywords",
	"import:legacy-keywords",
] as const;

const commandLoaders: Record<
	(typeof CLI_COMMANDS)[number],
	() => Promise<CliHandler>
> = {
	"user:create": async () =>
		(await import("./commands/user-create.ts")).userCreate,
	"user:list": async () => (await import("./commands/user-list.ts")).userList,
	seed: async () => async () => (await import("./commands/seed.ts")).seed(),
	"seed:resources": async () =>
		(await import("./commands/seed-resources.ts")).seedResources,
	"fts:reindex": async () => async () =>
		(await import("./commands/fts-reindex.ts")).ftsReindex(),
	"import:legacy-procomun": async () =>
		(await import("./commands/import-legacy-procomun.ts")).importLegacyProcomun,
	"import:legacy-users": async () =>
		(await import("./commands/import-legacy-users.ts")).importLegacyUsers,
	"elpx:screenshots": async () =>
		(await import("./commands/elpx-screenshots.ts")).elpxScreenshots,
	"elpx:thumbnails": async () =>
		(await import("./commands/elpx-thumbnails.ts")).elpxThumbnails,
	"catalog:area-keywords": async () =>
		(await import("./commands/catalog-area-keywords.ts")).catalogAreaKeywords,
	"import:legacy-keywords": async () =>
		(await import("./commands/import-legacy-keywords.ts")).importLegacyKeywords,
};

export function printHelp(log: Pick<typeof console, "log"> = console) {
	log.log("Procomun CLI\n");
	log.log("Comandos disponibles:");
	log.log(
		"  user:create  --email <email> --name <nombre> --role <rol> --password <pass>",
	);
	log.log("  user:list");
	log.log(
		"  seed              Crear usuarios de desarrollo (admin, curator, author, reader)",
	);
	log.log(
		"  seed:resources    Generar recursos aleatorios (--count 10, 100, 1000, 10000 --clean)",
	);
	log.log("  fts:reindex       Reindexar search_vector de todos los recursos");
	log.log(
		"  import:legacy-procomun --source-dir <ruta> [--dry-run] [--limit <n>] [--only <externalId>] [--report-dir <ruta>]",
	);
	log.log(
		"                    Importa recursos y artículos legacy de Procomún (pares .json+.elpx), ver ADR-0029",
	);
	log.log(
		"  import:legacy-procomun --backfill-categories [--dry-run] [--report-dir <ruta>]",
	);
	log.log(
		"                    Clasifica los recursos legacy ya importados que no tienen categorización (#383)",
	);
	log.log(
		"  import:legacy-procomun --copy-previews [--dry-run] [--report-dir <ruta>]",
	);
	log.log(
		"                    Copia a nuestro almacenamiento las miniaturas legacy enlazadas en caliente (#409)",
	);
	log.log(
		"  import:legacy-procomun --link-authors --source-dir <ruta> [--dry-run] [--report-dir <ruta>] [--restricted-report <ruta>]",
	);
	log.log(
		"                    Pasa lo ya importado a la cuenta de su autor por publicatorEmailStr; solo lee los .json (#456)",
	);
	log.log(
		"  import:legacy-users --source-file <usuarios.json> [--dry-run] [--limit <n>] [--report-dir <ruta>]",
	);
	log.log(
		"  import:legacy-users --fix-roles --source-file <usuarios.json> [--dry-run] [--limit <n>] [--report-dir <ruta>]",
	);
	log.log(
		"                    Pasa a editor las cuentas legacy importadas como author (#507)",
	);
	log.log(
		"  elpx:screenshots [--dry-run]  Detecta screenshot.png en los paquetes ya subidos (#409)",
	);
	log.log("  elpx:thumbnails [--dry-run] [--limit <n>] [--force]");
	log.log(
		"                    Encola la miniatura generada de los paquetes sin imagen (#470)",
	);
	log.log(
		"  catalog:area-keywords [--apply] [--include <id,id>] [--report-dir <ruta>]",
	);
	log.log(
		"                    Cruza palabras clave con áreas de conocimiento y retira las que pasan a ser áreas (#448)",
	);
	log.log("  import:legacy-keywords [--dry-run] [--report-dir <ruta>]");
	log.log(
		"                    Asigna palabras del catálogo a las etiquetas de origen, ver ADR-0042",
	);
}

export async function loadCommand(command: string): Promise<CliHandler | null> {
	if (!CLI_COMMANDS.includes(command as (typeof CLI_COMMANDS)[number])) {
		return null;
	}

	return commandLoaders[command as (typeof CLI_COMMANDS)[number]]();
}

export async function runCli(argv = process.argv.slice(2)) {
	const [command, ...args] = argv;

	if (!command || command === "--help" || command === "-h") {
		printHelp();
		process.exit(0);
	}

	const handler = await loadCommand(command);
	if (!handler) {
		console.error(`Comando desconocido: ${command}`);
		console.error(`Comandos disponibles: ${CLI_COMMANDS.join(", ")}`);
		process.exit(1);
	}

	await handler(args);
	applySuccessfulCliExit();
}

if (import.meta.main) {
	runCli()
		.then(() => {
			process.exit(applySuccessfulCliExit());
		})
		.catch((err) => {
			console.error("Error:", err.message ?? err);
			process.exit(1);
		});
}
