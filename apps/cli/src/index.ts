type CliHandler = (args: string[]) => Promise<void>;

export const CLI_COMMANDS = [
	"user:create",
	"user:list",
	"seed",
	"seed:resources",
	"fts:reindex",
	"import:legacy-procomun",
	"import:legacy-users",
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
		"                    Importa recursos legacy de Procomún (pares .json+.elpx), ver ADR-0029",
	);
	log.log(
		"  import:legacy-users --source-file <usuarios.json> [--dry-run] [--limit <n>] [--report-dir <ruta>]",
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
}

if (import.meta.main) {
	runCli().catch((err) => {
		console.error("Error:", err.message ?? err);
		process.exit(1);
	});
}
