import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import type {
	ApiClient,
	MediaItemRecord,
	UploadSessionRecord,
} from "./api-client.ts";
import { escapeHtml, formatBytes } from "./resource-display.ts";

export { escapeHtml, formatBytes };

type UploaderController = {
	destroy(): void;
};

const activeUploaders = new WeakMap<HTMLElement, UploaderController>();
const uploaderInitializations = new WeakMap<HTMLElement, object>();

export function extractUploadId(uploadUrl?: string | null) {
	if (!uploadUrl) return null;
	return uploadUrl.split("/").pop() ?? null;
}

export function renderPersistedUploadItem(upload: UploadSessionRecord) {
	const cancellable = !["completed", "cancelled"].includes(upload.status);
	return `<li>
		<strong>${escapeHtml(upload.originalFilename)}</strong>
		<span>${formatBytes(upload.receivedBytes)} / ${formatBytes(upload.declaredSize ?? null)}</span>
		<span class="upload-status upload-status-${escapeHtml(upload.status)}">${escapeHtml(upload.status)}</span>
		${upload.errorMessage ? `<span class="upload-error">${escapeHtml(upload.errorMessage)}</span>` : ""}
		${cancellable ? `<button type="button" data-cancel-upload="${escapeHtml(upload.id)}">Cancelar</button>` : ""}
	</li>`;
}

export function renderMediaItem(item: MediaItemRecord) {
	const isGenerated = item.filename === "recurso-generado.elpx";
	const deleteBtn = isGenerated
		? ""
		: `<button type="button" class="upload-delete-btn" data-delete-media="${escapeHtml(item.id)}" title="Eliminar archivo">✕</button>`;
	return `<li>
		<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.filename ?? item.id)}</a>
		<span>${formatBytes(item.fileSize ?? null)}</span>
		${deleteBtn}
	</li>`;
}

export function renderQueueItem(file: {
	id: string;
	name?: string | null;
	size?: number | null;
	error?: string | null;
	progress?: { percentage?: number | null };
	response?: { uploadURL?: string | null } | null;
}) {
	const progress = Math.round(file.progress?.percentage ?? 0);
	const uploadId = extractUploadId(file.response?.uploadURL ?? undefined);
	return `<li>
		<strong>${escapeHtml(file.name ?? "Archivo")}</strong>
		<span>${formatBytes(file.size ?? null)}</span>
		<progress max="100" value="${progress}"></progress>
		<span>${progress}%</span>
		${file.error ? `<span class="upload-error">${escapeHtml(file.error)}</span>` : ""}
		<button type="button" data-remove-local="${escapeHtml(file.id)}" data-upload-id="${escapeHtml(uploadId ?? "")}">
			${progress >= 100 ? "Quitar" : "Cancelar"}
		</button>
	</li>`;
}

export async function initResourceUploader(args: {
	resourceId: string;
	root: HTMLElement;
	api: ApiClient;
	onUploadComplete?: (successCount: number) => Promise<void>;
}) {
	const { resourceId, root, api } = args;
	const initToken = {};
	uploaderInitializations.set(root, initToken);

	const config = await api.getUploadConfig();
	if (uploaderInitializations.get(root) !== initToken) return null;

	// A route/search-param transition can initialize the same panel again without
	// unmounting it. Tear down the previous instance before adding new listeners.
	activeUploaders.get(root)?.destroy();

	const picker = root.querySelector<HTMLInputElement>("[data-upload-input]");
	const dropzone = root.querySelector<HTMLElement>("[data-upload-dropzone]");
	const queue = root.querySelector<HTMLElement>("[data-upload-queue]");
	const mediaList = root.querySelector<HTMLElement>("[data-media-list]");
	const persistedList = root.querySelector<HTMLElement>(
		"[data-persisted-uploads]",
	);
	const globalProgress = root.querySelector<HTMLProgressElement>(
		"[data-global-progress]",
	);
	const globalLabel = root.querySelector<HTMLElement>(
		"[data-global-progress-label]",
	);
	const feedback = root.querySelector<HTMLElement>("[data-upload-feedback]");

	if (
		!picker ||
		!dropzone ||
		!queue ||
		!mediaList ||
		!persistedList ||
		!globalProgress ||
		!globalLabel ||
		!feedback
	) {
		if (uploaderInitializations.get(root) === initToken) {
			uploaderInitializations.delete(root);
		}
		return null;
	}

	// Re-bind after the compound null-guard so nested callbacks see definite DOM nodes.
	// TypeScript does not always preserve multi-variable narrowing inside closures.
	const pickerEl: HTMLInputElement = picker;
	const dropzoneEl: HTMLElement = dropzone;
	const queueEl: HTMLElement = queue;
	const mediaListEl: HTMLElement = mediaList;
	const persistedListEl: HTMLElement = persistedList;
	const globalProgressEl: HTMLProgressElement = globalProgress;
	const globalLabelEl: HTMLElement = globalLabel;
	const feedbackEl: HTMLElement = feedback;

	const abortController = new AbortController();
	const listenerOptions: AddEventListenerOptions = {
		signal: abortController.signal,
	};
	const uppy = new Uppy({
		autoProceed: true,
		restrictions: {
			maxFileSize: config.maxFileSizeBytes,
			maxNumberOfFiles: config.maxFilesPerBatch,
			allowedFileTypes: [
				...config.allowedExtensions,
				...config.allowedMimeTypes,
			],
		},
	});

	uppy.use(Tus, {
		endpoint: "/api/uploads",
		withCredentials: true,
		chunkSize: config.chunkSizeBytes,
		retryDelays: [0, 1000, 3000, 5000],
		allowedMetaFields: ["resourceId", "filename", "mimeType"],
	});

	async function refreshPersisted() {
		const [uploads, mediaItems] = await Promise.all([
			api.listResourceUploads(resourceId),
			api.listResourceMediaItems(resourceId),
		]);

		persistedListEl.innerHTML = uploads.length
			? uploads.map((upload) => renderPersistedUploadItem(upload)).join("")
			: "<li>No hay uploads recientes.</li>";

		const displayItems = mediaItems.filter(
			(item) => item.filename !== "recurso-generado.elpx",
		);
		mediaListEl.innerHTML = displayItems.length
			? displayItems.map((item) => renderMediaItem(item)).join("")
			: "<li>No hay archivos adjuntos todavía.</li>";
	}

	function renderLocalQueue() {
		const files = uppy.getFiles();
		queueEl.innerHTML = files.length
			? files.map((file) => renderQueueItem(file)).join("")
			: "<li>No hay archivos en cola.</li>";

		const totalBytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
		const uploadedBytes = files.reduce((sum, file) => {
			const percentage = (file.progress?.percentage ?? 0) / 100;
			return sum + Math.round((file.size ?? 0) * percentage);
		}, 0);
		const globalPercentage =
			totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0;
		globalProgressEl.value = globalPercentage;
		globalLabelEl.textContent =
			totalBytes > 0
				? `${globalPercentage}% subido (${formatBytes(uploadedBytes)} / ${formatBytes(totalBytes)})`
				: "Sin subidas activas";
	}

	async function addFiles(files: FileList | File[]) {
		const entries = Array.from(files);
		if (entries.length > config.maxFilesPerBatch) {
			feedbackEl.textContent = `Solo se permiten ${config.maxFilesPerBatch} archivos por lote.`;
			feedbackEl.className = "upload-feedback error";
			return;
		}

		for (const file of entries) {
			try {
				uppy.addFile({
					name: file.name,
					type: file.type,
					data: file,
					meta: {
						resourceId,
						filename: file.name,
						mimeType: file.type,
						// Include resourceId in relativePath so the tus fingerprint is
						// resource-specific. Without this, uploading the same file to
						// different resources reuses the cached tus URL and skips
						// onUploadFinish on the server (no media_item created).
						relativePath: `${resourceId}/${file.name}`,
					},
				});
			} catch (error) {
				feedbackEl.textContent =
					error instanceof Error
						? error.message
						: "No se pudo añadir el archivo";
				feedbackEl.className = "upload-feedback error";
			}
		}
		renderLocalQueue();
	}

	pickerEl.addEventListener(
		"change",
		async () => {
			if (pickerEl.files?.length) {
				await addFiles(pickerEl.files);
				pickerEl.value = "";
			}
		},
		listenerOptions,
	);

	dropzoneEl.addEventListener(
		"dragover",
		(event) => {
			event.preventDefault();
			dropzoneEl.classList.add("is-dragover");
		},
		listenerOptions,
	);
	dropzoneEl.addEventListener(
		"dragleave",
		() => dropzoneEl.classList.remove("is-dragover"),
		listenerOptions,
	);
	dropzoneEl.addEventListener(
		"drop",
		async (event) => {
			event.preventDefault();
			dropzoneEl.classList.remove("is-dragover");
			if (event.dataTransfer?.files?.length) {
				await addFiles(event.dataTransfer.files);
			}
		},
		listenerOptions,
	);

	queueEl.addEventListener(
		"click",
		async (event) => {
			const target = event.target as HTMLElement | null;
			const fileId = target?.getAttribute("data-remove-local");
			if (!target || !fileId) return;
			const uploadId = target.getAttribute("data-upload-id");
			uppy.removeFile(fileId);
			if (uploadId) {
				await api.cancelUpload(uploadId).catch(() => {});
				await refreshPersisted();
			}
			renderLocalQueue();
		},
		listenerOptions,
	);

	persistedListEl.addEventListener(
		"click",
		async (event) => {
			const target = event.target as HTMLElement | null;
			const uploadId = target?.getAttribute("data-cancel-upload");
			if (!uploadId) return;
			await api.cancelUpload(uploadId);
			await refreshPersisted();
		},
		listenerOptions,
	);

	mediaListEl.addEventListener(
		"click",
		async (event) => {
			const target = event.target as HTMLElement | null;
			const mediaItemId = target?.getAttribute("data-delete-media");
			if (!mediaItemId) return;
			if (!window.confirm("¿Eliminar este archivo del recurso?")) return;
			try {
				await api.deleteMediaItem(resourceId, mediaItemId);
				await refreshPersisted();
				if (args.onUploadComplete) await args.onUploadComplete(0);
			} catch (err) {
				feedbackEl.textContent =
					err instanceof Error ? err.message : "Error al eliminar el archivo";
				feedbackEl.className = "upload-feedback error";
			}
		},
		listenerOptions,
	);

	uppy.on("file-added", renderLocalQueue);
	uppy.on("upload-progress", renderLocalQueue);
	uppy.on("upload-success", async () => {
		feedbackEl.textContent = "Archivo subido correctamente.";
		feedbackEl.className = "upload-feedback success";
		renderLocalQueue();
		await refreshPersisted();
	});
	uppy.on("upload-error", (_file, error) => {
		feedbackEl.textContent = error?.message ?? "Error durante la subida";
		feedbackEl.className = "upload-feedback error";
		renderLocalQueue();
	});
	uppy.on("file-removed", renderLocalQueue);
	uppy.on("complete", async (result) => {
		const count = result.successful?.length ?? 0;
		if (count > 0 && args.onUploadComplete) {
			await args.onUploadComplete(count);
		}
	});

	function handleBeforeUnload(event: BeforeUnloadEvent) {
		const hasActiveUploads = uppy
			.getFiles()
			.some((file) => (file.progress?.uploadComplete ?? false) === false);
		if (!hasActiveUploads) return;
		event.preventDefault();
		event.returnValue = "";
	}

	window.addEventListener("beforeunload", handleBeforeUnload, listenerOptions);

	let destroyed = false;
	const controller: UploaderController = {
		destroy() {
			if (destroyed) return;
			destroyed = true;
			abortController.abort();
			try {
				uppy.destroy();
			} finally {
				if (activeUploaders.get(root) === controller) {
					activeUploaders.delete(root);
				}
				if (uploaderInitializations.get(root) === initToken) {
					uploaderInitializations.delete(root);
				}
			}
		},
	};
	activeUploaders.set(root, controller);

	try {
		await refreshPersisted();
		renderLocalQueue();
		return controller;
	} catch (error) {
		controller.destroy();
		throw error;
	}
}
