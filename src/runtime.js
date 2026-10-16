/**
 * Worker-side glue shared by the Astro components: finds the stored variants
 * for a media value, or schedules their creation after the response.
 */
import { env, waitUntil } from "cloudflare:workers";
import { matchInternalMediaKey } from "emdash/media/image-endpoint";

import { bindings, generate, isSafeKey, readManifest } from "./variants.js";

/** Resize jobs in flight in this isolate, so parallel first views share one. */
const pending = new Map();

/**
 * Storage key of a local media value. Field values carry `meta.storageKey`;
 * Portable Text assets carry the media URL. Both come from content, so only
 * keys EmDash itself would serve are accepted.
 */
export function storageKeyOf(value) {
	if (!value || typeof value !== "object" || (value.provider ?? "local") !== "local") return undefined;
	const key = value.meta?.storageKey ?? matchInternalMediaKey(value.url);
	return isSafeKey(key) ? key : undefined;
}

/**
 * Manifest for the given storage key, or null. On a miss the variants are
 * created after the response, so the next render can use them.
 * @returns {Promise<import("./variants.js").Manifest | null>}
 */
export async function lookup(storageKey) {
	const names = bindings();
	const media = env[names.media];
	const variants = env[names.variants];
	if (!isSafeKey(storageKey) || !media || !variants) return null;
	const manifest = await readManifest(media, variants, storageKey).catch(() => null);
	if (manifest) return manifest;

	const images = env[globalThis.__ASTRO_IMAGES_BINDING_NAME || "IMAGES"];
	if (images && !pending.has(storageKey)) {
		const job = generate(media, variants, images, storageKey)
			.catch((error) => console.error("[r2-variants] generate failed", storageKey, error))
			.finally(() => pending.delete(storageKey));
		pending.set(storageKey, job);
		waitUntil(job);
	}
	return null;
}
