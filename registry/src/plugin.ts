import type { SandboxedPlugin } from "emdash/plugin";

/** Must match the page `path` under `admin.pages` in emdash-plugin.jsonc. */
export const ABOUT_PATH = "/about";

const NATIVE_PACKAGE = "emdash-plugin-r2-variants";
const REPO = "https://github.com/rjstech2020/emdash-plugin-r2-variants";

const link = (label: string, url: string) =>
	({ type: "link", label, appearance: "secondary", target: { kind: "external", url } }) as const;

// Section text renders as plain text, so links are link elements. The native
// package's version is never stated here: this listing is versioned separately.
const aboutPage = {
	blocks: [
		{ type: "header", text: "R2 Image Variants" },
		{
			type: "section",
			text:
				"R2 Image Variants resizes each media image once with the Cloudflare Images binding, stores the copies in R2, " +
				"and renders srcset URLs that point at them. " +
				"This is its Registry listing: installing it from the Registry adds only this page. " +
				"The feature itself is the native plugin, installed from npm.",
		},
		{
			type: "section",
			text:
				"Why native? The plugin reads and writes R2 through the site's bindings, resizes with the Images binding, " +
				"and ships Astro components that replace how images render. The Registry lists only sandboxed plugins, " +
				"so you install it from npm and register it in plugins: [] in astro.config.mjs.",
		},
		{ type: "code", code: `npm install ${NATIVE_PACKAGE}`, language: "bash" },
		{
			type: "actions",
			elements: [
				link("npm", `https://www.npmjs.com/package/${NATIVE_PACKAGE}`),
				link("README", `${REPO}#readme`),
			],
		},
	],
};

const isAboutPageLoad = (input: unknown) =>
	typeof input === "object" &&
	input !== null &&
	(input as { type?: unknown }).type === "page_load" &&
	(input as { page?: unknown }).page === ABOUT_PATH;

const plugin = {
	routes: {
		admin: {
			handler: async ({ input }: { input: unknown }) => (isAboutPageLoad(input) ? aboutPage : { blocks: [] }),
		},
	},
} satisfies SandboxedPlugin;

export default plugin;
