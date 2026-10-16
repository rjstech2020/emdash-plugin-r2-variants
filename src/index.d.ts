import type { PluginDescriptor } from "emdash";

export interface R2VariantsOptions {
	/** R2 binding EmDash stores media in. Default "MEDIA". */
	binding?: string;
	/**
	 * R2 binding for the resized copies. Recommended when the copies get a public
	 * domain, so the media bucket (originals, EmDash's private files) stays private.
	 * Requires `publicUrl`. Default: the media bucket.
	 */
	variantsBinding?: string;
	/** https:// custom domain attached to the variants bucket, e.g. "https://images.example.com". Empty: serve through EmDash's media route. */
	publicUrl?: string;
	/** Widths to create, in pixels, up to 4000. Default [320, 640, 960, 1280, 1920]. */
	widths?: number[];
	/** Output format. Default "webp". */
	format?: "webp" | "avif";
	/** Encoder quality, 1-100. Default: EmDash's transform quality (85). */
	quality?: number;
}

export function r2Variants(options?: R2VariantsOptions): PluginDescriptor<R2VariantsOptions>;
export default r2Variants;
