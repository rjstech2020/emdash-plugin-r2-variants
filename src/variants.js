/**
 * Core logic. Free of `cloudflare:workers`, so it loads in astro.config.mjs and
 * under `node --test`.
 *
 * Layout in the variants bucket (the media bucket unless `variantsBinding` is set):
 *   _variants/<storageKey>/manifest.json           which variants exist, for which original
 *   _variants/<storageKey>/<etag>/<width>.<format> one resized copy per width
 *
 * The original's R2 etag is part of every variant path. EmDash's "replace media"
 * overwrites the original under the same key, which changes the etag, so a
 * replaced image gets new URLs and long-lived CDN copies never go stale.
 */
import {
	DEFAULT_TRANSFORM_QUALITY,
	IMMUTABLE_IMAGE_CACHE,
	MAX_TRANSFORM_DIMENSION,
	isSafeTransformKey,
} from "emdash/media/image-endpoint";

/** @typedef {{ binding: string, variantsBinding: string, publicUrl: string, widths: number[], format: "webp" | "avif", quality: number }} Config */
/** @typedef {{ key: string, etag: string, format: string, width: number, height: number, widths: number[] }} Manifest */

const PREFIX = "_variants";
// Both output formats drop all EXIF metadata, so GPS data in originals never reaches the public copies.
const FORMATS = { webp: "image/webp", avif: "image/avif" };
const RESIZABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
// Originals are buffered in Worker memory; larger files keep EmDash's own rendering.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

/** @type {Config} */
export const config = {
	binding: "MEDIA",
	variantsBinding: "",
	publicUrl: "",
	widths: [320, 640, 960, 1280, 1920],
	format: "webp",
	quality: DEFAULT_TRANSFORM_QUALITY,
};

/**
 * Options merged over the defaults. Throws on a setup that would break images.
 * @param {Partial<Config>} options
 * @returns {Config}
 */
export function validate(options = {}) {
	const c = { ...config, ...options, publicUrl: (options.publicUrl ?? config.publicUrl).replace(/\/+$/, "") };
	const fail = (message) => {
		throw new Error(`[r2-variants] ${message}`);
	};
	if (c.publicUrl && !c.publicUrl.startsWith("https://")) fail("`publicUrl` must start with https://.");
	// EmDash's media route only reads the media bucket, so a separate bucket needs its own domain.
	if (c.variantsBinding && c.variantsBinding !== c.binding && !c.publicUrl) {
		fail("`variantsBinding` requires `publicUrl`: the custom domain attached to that bucket.");
	}
	if (!FORMATS[c.format]) fail('`format` must be "webp" or "avif".');
	if (!Number.isInteger(c.quality) || c.quality < 1 || c.quality > 100) fail("`quality` must be an integer from 1 to 100.");
	if (!c.widths.length || !c.widths.every((w) => Number.isInteger(w) && w > 0 && w <= MAX_TRANSFORM_DIMENSION)) {
		fail(`\`widths\` must be integers from 1 to ${MAX_TRANSFORM_DIMENSION}.`);
	}
	return c;
}

/** @param {Partial<Config>} options */
export function configure(options) {
	Object.assign(config, validate(options));
}

/** Binding names for originals and variants. */
export const bindings = () => ({ media: config.binding, variants: config.variantsBinding || config.binding });

/** Storage keys EmDash itself would serve: flat `{ulid}{ext}` names, never private folders such as `transfers/`. */
export const isSafeKey = (key) => typeof key === "string" && isSafeTransformKey(key);

const manifestKey = (key) => `${PREFIX}/${key}/manifest.json`;

/**
 * The manifest for `key`, or null when variants are missing or were made from
 * an earlier version of the original.
 * @returns {Promise<Manifest | null>}
 */
export async function readManifest(media, variants, key) {
	const [original, stored] = await Promise.all([media.head(key), variants.get(manifestKey(key))]);
	if (!original || !stored) return null;
	const m = await stored.json();
	return m.etag === original.etag ? { ...m, key } : null;
}

/**
 * Resize the original once per configured width and store the results.
 * Widths larger than the original are skipped; the original width (capped at
 * EmDash's transform limit) is always included.
 * @returns {Promise<Manifest | null>} null when the original is missing, too large, or not a resizable raster.
 */
export async function generate(media, variants, images, key) {
	const original = await media.get(key);
	if (!original) return null;
	if (!RESIZABLE.has(original.httpMetadata?.contentType) || original.size > MAX_SOURCE_BYTES) {
		await original.body?.cancel();
		return null;
	}
	const bytes = await original.arrayBuffer();
	const { width, height } = await images.info(new Response(bytes).body);
	if (!width || !height) return null;

	const largest = Math.min(width, MAX_TRANSFORM_DIMENSION);
	const widths = [...new Set([...config.widths.filter((w) => w < largest), largest])].sort((a, b) => a - b);
	const { etag } = original;
	const { format } = config;
	for (const w of widths) {
		const out = await images
			.input(new Response(bytes).body)
			.transform({ width: w })
			.output({ format: FORMATS[format], quality: config.quality });
		// R2 needs a known length, so buffer instead of streaming.
		await variants.put(`${PREFIX}/${key}/${etag}/${w}.${format}`, await out.response().arrayBuffer(), {
			httpMetadata: { contentType: FORMATS[format], cacheControl: IMMUTABLE_IMAGE_CACHE },
		});
	}

	const manifest = { etag, format, width, height, widths };
	// Written last: a manifest only exists once every variant it lists does.
	await variants.put(manifestKey(key), JSON.stringify(manifest), {
		httpMetadata: { contentType: "application/json", cacheControl: "no-cache" },
	});
	return { ...manifest, key };
}

/**
 * Delete variants whose original was deleted or replaced.
 * @returns {Promise<number>} objects removed
 */
export async function cleanup(media, variants) {
	const prefix = `${PREFIX}/`;
	const etags = new Map(); // storageKey -> current etag, or null when the original is gone
	const currentEtag = async (key) => {
		if (!etags.has(key)) etags.set(key, (await media.head(key))?.etag ?? null);
		return etags.get(key);
	};

	let removed = 0;
	let cursor;
	do {
		const page = await variants.list({ prefix, cursor });
		const stale = [];
		for (const { key: name } of page.objects) {
			const [key, second, third] = name.slice(prefix.length).split("/");
			const etag = await currentEtag(key);
			// <key>/manifest.json stays while the original exists; <key>/<etag>/<file> only for the current etag.
			if (etag === null || (third !== undefined && second !== etag)) stale.push(name);
		}
		if (stale.length) await variants.delete(stale);
		removed += stale.length;
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return removed;
}

/** Public URL of one variant. Without `publicUrl`, EmDash's media route serves it. */
function variantUrl(m, width) {
	const path = `${PREFIX}/${m.key}/${m.etag}/${width}.${m.format}`;
	return config.publicUrl ? `${config.publicUrl}/${path}` : `/_emdash/api/media/file/${path}`;
}

/**
 * srcset/src/sizes for an image displayed `displayWidth` CSS pixels wide.
 * Lists variants up to 2x the display width for high-density screens.
 */
export function responsive(m, displayWidth) {
	const fits = m.widths.filter((w) => w <= displayWidth * 2);
	const src = m.widths.find((w) => w >= displayWidth) ?? m.widths.at(-1);
	return {
		src: variantUrl(m, src),
		srcset: (fits.length ? fits : [m.widths[0]]).map((w) => `${variantUrl(m, w)} ${w}w`).join(", "),
		sizes: `(min-width: ${displayWidth}px) ${displayWidth}px, 100vw`,
	};
}

const unit = (v) => typeof v === "number" && v >= 0 && v <= 1;
const percent = (v) => `${Math.round(v * 10000) / 100}%`;

/**
 * <img> attributes for a stored image. `width`/`height` are the display size;
 * either may be omitted and is then derived from the original's aspect ratio.
 * A display box with a different aspect ratio is filled with object-fit: cover.
 * Focal point and colour come from content, so only well-formed values reach the style attribute.
 */
export function imgAttrs(m, { width, height, focalX, focalY, dominantColor } = {}) {
	const ratio = m.width / m.height;
	const w = width ?? (height ? Math.round(height * ratio) : m.width);
	const h = height ?? Math.round(w / ratio);
	const style = [
		"max-width:100%;height:auto",
		Math.abs(w / h - ratio) > 0.01 && "object-fit:cover",
		unit(focalX) && unit(focalY) && `object-position:${percent(focalX)} ${percent(focalY)}`,
		HEX_COLOR.test(dominantColor ?? "") && `background-color:${dominantColor}`,
	]
		.filter(Boolean)
		.join(";");
	return { ...responsive(m, w), width: w, height: h, style };
}
