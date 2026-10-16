/**
 * Native plugin runtime. EmDash imports `createPlugin` from here and calls it
 * with the descriptor's options when the site starts.
 */
import { env } from "cloudflare:workers";
import { definePlugin } from "emdash";

import { bindings, cleanup, configure } from "./variants.js";

const scheduleCleanup = async (_event, ctx) => {
	await ctx.cron.schedule("cleanup", { schedule: "17 3 * * *" });
};

/** @param {Partial<import("./variants.js").Config>} options */
export function createPlugin(options = {}) {
	configure(options);
	return definePlugin({
		id: "r2-variants",
		version: "0.1.0",
		// media:read is what EmDash requires for media:afterUpload.
		capabilities: ["media:read"],
		hooks: {
			// Plugins declared in astro.config never get plugin:activate, so the
			// first upload schedules the job too. schedule() upserts by name.
			"plugin:activate": scheduleCleanup,
			"media:afterUpload": scheduleCleanup,
			cron: async (event, ctx) => {
				if (event.name !== "cleanup") return;
				const { media, variants } = bindings();
				const removed = await cleanup(env[media], env[variants]);
				ctx.log.info("Removed stale image variants", { removed });
			},
		},
	});
}
