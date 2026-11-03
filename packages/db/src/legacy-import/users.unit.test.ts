import { describe, expect, test } from "bun:test";
import { type LegacyUserJson, mapLegacyRoles, mapLegacyUser } from "./users.ts";

/** Registro con la forma del exportador (issue #456), con datos ficticios. */
function legacyRecord(overrides: Partial<LegacyUserJson> = {}): LegacyUserJson {
	return {
		uid: 85,
		name: "ana.docente@example.test",
		pass: "$S$E6rSBHqMIJwP/yOyG9ctZ0MoaC6ml0ahKsvSQ0lbnRLYBOYSB2Qv",
		mail: "Ana.Docente@Example.TEST",
		timezone: "Europe/Madrid",
		status: 1,
		field_birthdate_value: "1985-12-30",
		field_country_country_code: "ES",
		field_country_administrative_area: "Burgos",
		field_country_locality: "burgos",
		field_descripcion_org_value: null,
		field_dni_value: "00000000T",
		field_educative_center_value: "CRA El Ejemplo",
		field_educative_center_url_uri: "www.cra-ejemplo.example",
		field_name_value: "Ana",
		field_sexo_value: "M",
		field_sobre_mi_value: "Docente de primaria.\r\nCoordinadora TIC.",
		field_surname_value: "Docente",
		field_surname_2_value: "Ejemplo",
		field_user_nivel_estudios_value: "Licenciatura",
		field_user_ocupacion_actual_value: "Profesora",
		field_user_otros_estudios_value: "Máster",
		field_user_facebook_value: null,
		field_user_linkedin_value: "https://www.linkedin.com/in/ana-docente",
		field_user_twitter_value: "@anadocente",
		field_website_value: "https://ana.example/blog",
		roles: "-",
		user_picture: "public://pictures/foto.png",
		...overrides,
	};
}

describe("mapLegacyRoles", () => {
	// Tabla de la issue #456 corregida en #507: lo que antes daba `author` da
	// `editor`; `admin` no cambia.
	const TABLE: Array<[string | null | undefined, "admin" | "editor"]> = [
		["administrator", "admin"],
		["administrador", "admin"],
		["publicador_certificado", "editor"],
		["-", "editor"],
		["", "editor"],
		[null, "editor"],
		[undefined, "editor"],
		["bm_documentalista", "editor"],
		["gestor_de_odes", "editor"],
	];

	test("aplica la tabla de correspondencias de las issues #456 y #507", () => {
		for (const [raw, role] of TABLE) {
			expect({ raw, ...mapLegacyRoles(raw) }).toEqual({
				raw,
				role,
				unknownRoles: [],
			});
		}
	});

	test("ningún rol del Procomún anterior da author (#507)", () => {
		for (const raw of [
			...TABLE.map(([label]) => label),
			"Organization",
			"author",
			"bm_documentalista, gestor_de_odes",
		]) {
			expect(mapLegacyRoles(raw).role).not.toBe("author");
		}
	});

	test("con varios roles separados por coma, admin gana a editor", () => {
		expect(mapLegacyRoles("bm_documentalista, gestor_de_odes").role).toBe(
			"editor",
		);
		expect(mapLegacyRoles("gestor_de_odes,publicador_certificado").role).toBe(
			"editor",
		);
		expect(
			mapLegacyRoles("publicador_certificado, Administrador , -").role,
		).toBe("admin");
		expect(mapLegacyRoles("-,administrator").role).toBe("admin");
		expect(mapLegacyRoles("bm_documentalista,administrador").role).toBe(
			"admin",
		);
		expect(mapLegacyRoles("Organization, administrator")).toEqual({
			role: "admin",
			unknownRoles: ["Organization"],
		});
	});

	test("un rol desconocido entra como editor y se informa", () => {
		expect(mapLegacyRoles("Organization")).toEqual({
			role: "editor",
			unknownRoles: ["Organization"],
		});
		expect(mapLegacyRoles("organization, publicador_certificado")).toEqual({
			role: "editor",
			unknownRoles: ["organization"],
		});
		expect(mapLegacyRoles("Organization, rol_raro, -")).toEqual({
			role: "editor",
			unknownRoles: ["Organization", "rol_raro"],
		});
	});

	test("nunca asigna curator", () => {
		for (const raw of ["curator", "curador", "moderador", "reader"]) {
			expect(mapLegacyRoles(raw)).toEqual({
				role: "editor",
				unknownRoles: [raw],
			});
		}
		expect(mapLegacyRoles("curator, administrator").role).toBe("admin");
	});
});

describe("mapLegacyUser", () => {
	test("conserva el ID destino estable y normaliza el correo", () => {
		const mapped = mapLegacyUser(legacyRecord());
		expect(mapped.legacyUid).toBe("85");
		expect(mapped.id).toBe("legacy-procomun:user:85");
		expect(mapped.email).toBe("ana.docente@example.test");
	});

	test("el nombre visible es nombre más apellidos, nunca el correo de `name`", () => {
		expect(mapLegacyUser(legacyRecord()).name).toBe("Ana Docente Ejemplo");
		expect(
			mapLegacyUser(
				legacyRecord({
					field_name_value: "  Usuario ",
					field_surname_value: "Procomun",
					field_surname_2_value: null,
				}),
			).name,
		).toBe("Usuario Procomun");

		const sinNombre = mapLegacyUser(
			legacyRecord({
				field_name_value: null,
				field_surname_value: null,
				field_surname_2_value: null,
			}),
		);
		expect(sinNombre.name).toBeNull();
		expect(sinNombre.warnings.map((w) => w.field)).toContain("name");
	});

	test("usa `name` como nombre solo si no es un correo", () => {
		const mapped = mapLegacyUser(
			legacyRecord({
				name: "anadocente",
				field_name_value: null,
				field_surname_value: null,
				field_surname_2_value: null,
			}),
		);
		expect(mapped.name).toBe("anadocente");
	});

	test("marca como bloqueado status 0 (el importador lo descarta)", () => {
		expect(mapLegacyUser(legacyRecord({ status: 1 })).blocked).toBeFalse();
		expect(mapLegacyUser(legacyRecord({ status: undefined })).blocked).toBe(
			false,
		);
		for (const status of [0, "0", false] as const) {
			expect(mapLegacyUser(legacyRecord({ status })).blocked).toBeTrue();
		}
	});

	test("asigna el rol según la tabla y lista los roles desconocidos", () => {
		expect(mapLegacyUser(legacyRecord({ roles: "-" })).role).toBe("editor");
		expect(mapLegacyUser(legacyRecord({ roles: "administrator" })).role).toBe(
			"admin",
		);
		const org = mapLegacyUser(legacyRecord({ roles: "Organization" }));
		expect(org.role).toBe("editor");
		expect(org.unknownRoles).toEqual(["Organization"]);
		const warning = org.warnings.find((w) => w.field === "roles");
		expect(warning?.message).toContain("Organization");
		expect(warning?.message).toContain("entra como editor");
	});

	test("guarda el hash de contraseña en los formatos admitidos", () => {
		const drupal = "$S$E6rSBHqMIJwP/yOyG9ctZ0MoaC6ml0ahKsvSQ0lbnRLYBOYSB2Qv";
		expect(mapLegacyUser(legacyRecord()).passwordHash).toBe(drupal);
		const bcrypt =
			"$2y$10$NtYFUMRmtbKJyE.veX1nmuA5DC9GdFsrZVaUp6y6hIbFd5VDp//xi";
		expect(mapLegacyUser(legacyRecord({ pass: bcrypt })).passwordHash).toBe(
			bcrypt,
		);
	});

	test("descarta y avisa de hashes en formatos no admitidos o ausentes", () => {
		for (const pass of ["$P$Bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "", null]) {
			const mapped = mapLegacyUser(legacyRecord({ pass }));
			expect(mapped.passwordHash).toBeNull();
			expect(mapped.warnings.map((w) => w.field)).toContain("pass");
			// El aviso no incluye el hash.
			for (const warning of mapped.warnings) {
				expect(warning.message).not.toContain("$P$");
			}
		}
	});

	test("importa país, localidad, centro, web, «sobre mí» y redes", () => {
		expect(mapLegacyUser(legacyRecord()).profile).toEqual({
			countryCode: "ES",
			locality: "burgos",
			educationalCenter: "CRA El Ejemplo",
			educationalCenterUrl: "https://www.cra-ejemplo.example/",
			about: "Docente de primaria.\nCoordinadora TIC.",
			website: "https://ana.example/blog",
			facebook: null,
			linkedin: "https://www.linkedin.com/in/ana-docente",
			twitter: "@anadocente",
		});
	});

	test("no importa DNI, nacimiento, sexo, estudios, ocupación ni foto", () => {
		const serialized = JSON.stringify(mapLegacyUser(legacyRecord()));
		for (const value of [
			"00000000T",
			"1985-12-30",
			"Licenciatura",
			"Profesora",
			"Máster",
			"public://pictures",
			"Europe/Madrid",
		]) {
			expect(serialized).not.toContain(value);
		}
	});

	test("descarta URLs no web y códigos de país no válidos con aviso", () => {
		const mapped = mapLegacyUser(
			legacyRecord({
				field_website_value: "javascript:alert(1)",
				field_educative_center_url_uri: "ftp://centro.example",
				field_country_country_code: "Spain",
			}),
		);
		expect(mapped.profile?.website).toBeNull();
		expect(mapped.profile?.educationalCenterUrl).toBeNull();
		expect(mapped.profile?.countryCode).toBeNull();
		expect(mapped.warnings.map((w) => w.field)).toEqual(
			expect.arrayContaining([
				"field_website_value",
				"field_educative_center_url_uri",
				"field_country_country_code",
			]),
		);
	});

	test("sin datos de perfil no crea perfil", () => {
		const mapped = mapLegacyUser({
			uid: 7,
			mail: "solo-cuenta@example.test",
			roles: "-",
			status: 1,
		});
		expect(mapped.profile).toBeNull();
	});

	test("rechaza uid o email no utilizables", () => {
		expect(() => mapLegacyUser({ mail: "user@example.test" })).toThrow("uid");
		expect(() => mapLegacyUser({ uid: 1, mail: "incorrecto" })).toThrow("mail");
	});
});
