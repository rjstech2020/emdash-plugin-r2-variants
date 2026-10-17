import assert from "node:assert/strict";
import { test } from "node:test";

import plugin, { ABOUT_PATH } from "./plugin.ts";

const admin = (input: unknown) => plugin.routes.admin.handler({ input });

test("about page names npm as the install source", async () => {
	const { blocks } = await admin({ type: "page_load", page: ABOUT_PATH });
	const text = JSON.stringify(blocks);
	assert.match(text, /adds only this page/);
	assert.match(text, /npm install emdash-plugin-r2-variants/);
});

test("other admin requests get no blocks", async () => {
	for (const input of [undefined, null, "x", { type: "page_load", page: "/other" }, { type: "action", page: ABOUT_PATH }]) {
		assert.deepEqual(await admin(input), { blocks: [] });
	}
});
