/**
 * Known seed data references for E2E tests.
 * Keep in sync with packages/db/src/seed-data.ts.
 */

/** A published resource guaranteed to exist after seed (res-01). */
export const PUBLISHED_RESOURCE = {
	slug: 'sistemas-ia-etica-aplicaciones-aula',
	title: 'Sistemas de Inteligencia Artificial: Ética y Aplicaciones en el Aula',
};

/** A resource in draft state (res-21). */
export const DRAFT_RESOURCE = {
	slug: 'machine-learning-profes-borrador',
	title: 'Machine Learning para Profes (borrador)',
};

/** A public collection guaranteed to exist after seed (col-01). */
export const PUBLIC_COLLECTION = {
	slug: 'inteligencia-artificial-educacion',
	title: 'Inteligencia Artificial en Educación',
};

/** Search terms that should return results from seed data. */
export const SEARCH_TERMS = {
	withResults: 'educación',
	noResults: 'xyznonexistent999',
};

/** Filter values from seed data. */
export const FILTERS = {
	resourceType: 'presentación',
	level: 'secundaria',
	language: 'es',
	license: 'CC BY-SA 4.0',
};
