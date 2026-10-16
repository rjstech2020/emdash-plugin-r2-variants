import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanup, configure, generate, imgAttrs, isSafeKey, readManifest, responsive, validate } from "./variants.js";

/** In-memory stand-in for an R2 bucket: only the calls variants.js makes. */
function fakeBucket() {
	const objects = new Map();
	let n = 0;
	const obj = (key) => {
		const o = objects.get(key);
		return o && { key, etag: o.etag, httpMetadata: o.meta, arrayBuffer: async () => o.body, json: async () => JSON.parse(new TextDecoder().decode(o.body)) };
	};
	return {
		objects,
		async put(key, body, opts = {}) {
			const bytes = typeof body === "string" ? new TextEncoder().encode(body).buffer : body;
			objects.set(key, { body: bytes, etag: `e${++n}`, meta: opts.httpMetadata ?? {} });
		},
		async get(key) { return obj(key) ?? null; },
		async head(key) { return obj(key) ?? null; },
		async delete(keys) { for (const k of [].concat(keys)) objects.delete(k); },
		async list({ prefix }) {
			return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
		},
	};
}

/** Stand-in for the Images binding: records requested widths. */
function fakeImages(width, height) {
	const calls = [];
	return {
		calls,
		info: async () => ({ width, height }),
		input: () => ({
			transform: ({ width: w }) => ({
				output: async () => {
					calls.push(w);
					return { response: () => new Response(`w${w}`) };
				},
			}),
		}),
	};
}

test("generates each size once, then reads them back", async () => {
	configure({ widths: [320, 640, 960, 1280], publicUrl: "https://media.example.com/" });
	const bucket = fakeBucket();
	await bucket.put("a.jpg", new ArrayBuffer(8), { httpMetadata: { contentType: "image/jpeg" } });
	const images = fakeImages(1000, 500);

	assert.equal(await readManifest(bucket, bucket, "a.jpg"), null);
	const m = await generate(bucket, bucket, images, "a.jpg");
	assert.deepEqual(images.calls, [320, 640, 960, 1000], "no upscaling, original width included");
	assert.deepEqual(await readManifest(bucket, bucket, "a.jpg"), m);
	assert.ok(bucket.objects.has(`_variants/a.jpg/${m.etag}/640.webp`));

	const r = responsive(m, 480);
	assert.equal(r.src, `https://media.example.com/_variants/a.jpg/${m.etag}/640.webp`);
	assert.deepEqual(r.srcset.split(", ").map((s) => s.split(" ")[1]), ["320w", "640w", "960w"]);
});

test("replacing or deleting the original invalidates and cleans up variants", async () => {
	configure({ widths: [320], publicUrl: "" });
	const bucket = fakeBucket();
	const jpeg = { httpMetadata: { contentType: "image/jpeg" } };
	await bucket.put("a.jpg", new ArrayBuffer(8), jpeg);
	await bucket.put("b.jpg", new ArrayBuffer(8), jpeg);
	const old = await generate(bucket, bucket, fakeImages(800, 600), "a.jpg");
	await generate(bucket, bucket, fakeImages(800, 600), "b.jpg");

	await bucket.put("a.jpg", new ArrayBuffer(9), jpeg); // "replace media": same key, new etag
	await bucket.delete("b.jpg");
	assert.equal(await readManifest(bucket, bucket, "a.jpg"), null, "stale manifest is ignored");
	assert.match(responsive(old, 300).src, /^\/_emdash\/api\/media\/file\/_variants\//);

	const removed = await cleanup(bucket, bucket);
	assert.equal(removed, 5, "old a.jpg sizes (2) + b.jpg sizes (2) + b.jpg manifest");
	assert.deepEqual([...bucket.objects.keys()].sort(), ["_variants/a.jpg/manifest.json", "a.jpg"]);
});

test("skips formats it cannot resize", async () => {
	const bucket = fakeBucket();
	await bucket.put("logo.svg", new ArrayBuffer(8), { httpMetadata: { contentType: "image/svg+xml" } });
	assert.equal(await generate(bucket, bucket, fakeImages(100, 100), "logo.svg"), null);
});

test("img attributes: aspect ratio, crop, focal point", async () => {
	configure({ publicUrl: "" });
	const m = { key: "k", etag: "e", format: "webp", width: 1600, height: 1000, widths: [320, 640, 960, 1280, 1600] };
	const free = imgAttrs(m, { width: 800 });
	assert.equal(free.height, 500);
	assert.doesNotMatch(free.style, /object-fit/);
	const square = imgAttrs(m, { width: 480, height: 480, focalX: 0.25, focalY: 0.5 });
	assert.match(square.style, /object-fit:cover/);
	assert.match(square.style, /object-position:25% 50%/);
	assert.equal(imgAttrs(m, { height: 500 }).width, 800);
});

test("separate variants bucket: originals stay untouched", async () => {
	configure({ widths: [320], variantsBinding: "VARIANTS", publicUrl: "https://img.example.com" });
	const media = fakeBucket();
	const variants = fakeBucket();
	const jpeg = { httpMetadata: { contentType: "image/jpeg" } };
	await media.put("a.jpg", new ArrayBuffer(8), jpeg);
	await media.put("b.jpg", new ArrayBuffer(8), jpeg);

	const m = await generate(media, variants, fakeImages(800, 600), "a.jpg");
	await generate(media, variants, fakeImages(800, 600), "b.jpg");
	assert.deepEqual([...media.objects.keys()], ["a.jpg", "b.jpg"], "nothing written to the media bucket");
	assert.deepEqual(await readManifest(media, variants, "a.jpg"), m);
	assert.match(responsive(m, 300).src, /^https:\/\/img\.example\.com\/_variants\/a\.jpg\//);

	await media.delete("b.jpg");
	assert.equal(await cleanup(media, variants), 3, "b.jpg sizes (2) + manifest");
	assert.equal([...media.objects.keys()].length, 1);
	configure({ variantsBinding: "", publicUrl: "" });
});

test("a separate variants bucket without publicUrl is rejected", () => {
	assert.throws(() => configure({ variantsBinding: "VARIANTS", publicUrl: "" }), /requires `publicUrl`/);
	configure({ variantsBinding: "" });
});

test("security: only keys EmDash would serve are accepted", () => {
	assert.ok(isSafeKey("01ARZ3NDEKTSV4RRFFQ69G5FAV.webp"));
	for (const key of ["transfers/plan.json", "_variants/x/manifest.json", "a b.jpg", "x%2Fy", "", null, 42]) {
		assert.equal(isSafeKey(key), false, String(key));
	}
});

test("security: content values cannot inject CSS", () => {
	configure({ publicUrl: "" });
	const m = { key: "k", etag: "e", format: "webp", width: 100, height: 100, widths: [100] };
	const { style } = imgAttrs(m, {
		dominantColor: "red;background-image:url(https://evil.example/t)",
		focalX: "0.5;background:url(x)",
		focalY: 0.5,
	});
	assert.equal(style, "max-width:100%;height:auto");
	assert.match(imgAttrs(m, { dominantColor: "#a1b2c3" }).style, /background-color:#a1b2c3$/);
});

test("security: oversized and non-raster originals are not resized", async () => {
	const bucket = fakeBucket();
	await bucket.put("big.jpg", new ArrayBuffer(8), { httpMetadata: { contentType: "image/jpeg" } });
	const big = await bucket.get("big.jpg");
	bucket.get = async () => ({ ...big, size: 26 * 1024 * 1024, body: { cancel: async () => {} } });
	const images = fakeImages(100, 100);
	assert.equal(await generate(bucket, bucket, images, "big.jpg"), null);
	assert.deepEqual(images.calls, []);
});

test("options are validated", () => {
	assert.throws(() => validate({ publicUrl: "http://img.example.com" }), /https/);
	assert.throws(() => validate({ publicUrl: "javascript:alert(1)" }), /https/);
	assert.throws(() => validate({ format: "png" }), /format/);
	assert.throws(() => validate({ quality: 0 }), /quality/);
	assert.throws(() => validate({ widths: [0] }), /widths/);
	assert.throws(() => validate({ widths: [5000] }), /widths/);
	assert.doesNotThrow(() => validate({ variantsBinding: "V", publicUrl: "https://img.example.com/" }));
});
