import type { ApiClient } from "./api-client.ts";

export interface ResourceVersionRecord {
	id: string;
	versionNumber: number;
	fileSha256: string;
	elpxProjectId: string | null;
	createdBy: string | null;
	createdByName: string | null;
	createdAt: string | number | Date | null;
	originalFilename: string | null;
	uploadSessionId: string | null;
	isCurrent: boolean;
	downloadUrl: string | null;
}

export interface ResourceVersionApi {
	listResourceVersions(resourceId: string): Promise<ResourceVersionRecord[]>;
	restoreResourceVersion(
		resourceId: string,
		versionId: string,
	): Promise<{
		ok: boolean;
		versionNumber?: number;
		restoredFromVersionNumber?: number;
		error?: string;
	}>;
}

export function withResourceVersionApi<T extends ApiClient>(
	client: T,
): T & ResourceVersionApi {
	return Object.assign(client, {
		async listResourceVersions(resourceId: string) {
			const res = await fetch(
				`/api/admin/resources/${encodeURIComponent(resourceId)}/versions`,
			);
			if (!res.ok) return [];
			return res.json();
		},
		async restoreResourceVersion(resourceId: string, versionId: string) {
			const res = await fetch(
				`/api/admin/resources/${encodeURIComponent(resourceId)}/versions/${encodeURIComponent(versionId)}/restore`,
				{ method: "POST" },
			);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				return {
					ok: false,
					error: body.error ?? `HTTP ${res.status}`,
				};
			}
			return { ok: true, ...body };
		},
	});
}
