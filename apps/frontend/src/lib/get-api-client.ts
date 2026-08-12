import type { ApiClient } from "./api-client.ts";
import { HttpApiClient } from "./http-api-client.ts";
import {
	type ResourceVersionApi,
	withResourceVersionApi,
} from "./resource-version-api.ts";

let _client: (ApiClient & ResourceVersionApi) | null = null;

export async function getApiClient(): Promise<ApiClient & ResourceVersionApi> {
	if (_client) return _client;
	_client = withResourceVersionApi(new HttpApiClient());
	return _client;
}
