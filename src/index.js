/**
 * Plugin descriptor for astro.config.mjs. Validates options when the config
 * loads, so a broken setup fails the build rather than the first request.
 */
import { validate } from "./variants.js";

/**
 * @param {Partial<import("./variants.js").Config>} [options]
 * @returns {import("emdash").PluginDescriptor}
 */
export function r2Variants(options = {}) {
	validate(options);
	return {
		id: "r2-variants",
		version: "0.1.0",
		format: "native",
		entrypoint: "emdash-plugin-r2-variants/plugin",
		componentsEntry: "emdash-plugin-r2-variants/astro",
		options,
	};
}

export default r2Variants;
