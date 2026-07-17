export type DrizzleDB = {
	select: (...args: unknown[]) => unknown;
	insert: (...args: unknown[]) => unknown;
	update: (...args: unknown[]) => unknown;
	// Este `any` es el núcleo de la deuda de tipado de la capa de datos (Lote 1
	// de ADR-0030): tipar la base de drizzle de verdad exige la fuente única de
	// esquema, que es una tarea aparte. La supresión se acota a la regla
	// concreta: antes era un `biome-ignore lint:` en blanco, que silenciaba
	// TODAS las reglas de esta línea.
	// biome-ignore lint/suspicious/noExplicitAny: tipo genérico de la base drizzle, ver Lote 1 de ADR-0030
	[key: string]: any;
};
