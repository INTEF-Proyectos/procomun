import type { ApiClient } from "./api-client.ts";
import { HttpApiClient } from "./http-api-client.ts";

let _client: ApiClient | null = null;

/**
 * Devuelve el ApiClient (HttpApiClient contra el servidor API).
 */
export async function getApiClient(): Promise<ApiClient> {
	if (_client) return _client;
	_client = new HttpApiClient();
	return _client;
}
