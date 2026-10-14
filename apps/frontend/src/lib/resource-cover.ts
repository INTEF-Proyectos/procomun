import {
	isElpxCoverImagePath,
	isExternalCoverUrl,
} from "@procomun/db/elpx-cover";

export function resourceCoverSrc(input: {
	thumbnailUrl?: string | null;
	coverImageUrl?: string | null;
}): string | null {
	const cover = input.coverImageUrl?.trim() ?? "";
	if (cover && isElpxCoverImagePath(cover)) return cover;
	const thumb = input.thumbnailUrl?.trim() ?? "";
	if (thumb && isExternalCoverUrl(thumb)) return thumb;
	return null;
}
