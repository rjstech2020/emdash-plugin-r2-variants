<img src="https://raw.githubusercontent.com/rjstech2020/emdash-plugin-r2-variants/main/registry/images/icon.png" alt="" width="96" height="96" align="right">

# emdash-plugin-r2-variants

An [EmDash](https://github.com/emdash-cms/emdash) plugin for sites on Cloudflare
that resizes each image once and stores the resized copies in R2. Pages point their
`srcset` at the stored files.

By default, EmDash resizes media through the Cloudflare Images binding on every
request to `/_image` and sends `Cache-Control: max-age=0`, so every image view runs
your Worker and calls the Images service.

## Benefits

- **Lower Cloudflare Images usage.** Each width is resized once per version of an
  image. Cloudflare bills unique resizes again each month, so without the plugin a
  site pays for the same resizes every month.
- **Fewer Worker requests.** With a public variants bucket, image requests are
  served by R2 and the Cloudflare cache without invoking your Worker.
- **Faster repeat views.** Stored copies are sent with a one-year `immutable`
  cache header, so browsers and the Cloudflare cache keep them. A replaced image
  gets new URLs, so nobody sees a stale copy.
- **Little template work.** `Image` takes the same props as EmDash's. Images in
  rich-text content and dark-mode variants are handled with no template changes.
- **Private originals.** The resized copies can live in their own public bucket
  while the media bucket stays private.

**Status:** version 0.1.0, early release.

## How it works

- **Rendering.** The plugin's `Image` component reads
  `_variants/<storageKey>/manifest.json` from the bucket and checks it against the
  original's current etag. If they match, it renders an `<img>` whose `srcset` lists
  the stored files.
- **First view.** If there is no manifest yet, or the original has changed, that
  request renders with EmDash's own image component. After the response, the plugin
  creates every configured width with the Images binding and writes the manifest
  last. The next render uses the stored files.
- **Images in body content.** The plugin registers its own Portable Text `image`
  block, so images inside rich text work the same way with no template changes.
- **Dark-mode images.** When an image has a `darkVariant`, both images are served
  from stored files. EmDash's light and dark classes switch between them.
- **Replaced media.** EmDash overwrites a replaced file under the same key, which
  gives it a new etag. Variants live under `<storageKey>/<etag>/`, so a replaced
  image gets new URLs and cached copies of the old version are never shown.
- **Cleanup.** A daily job at 03:17 UTC deletes variants whose original was deleted
  or replaced. The first media upload schedules it.

## Requirements

- EmDash 1.1 or later with R2 storage from `@emdash-cms/cloudflare`
- `@astrojs/cloudflare` with its default Images binding (`IMAGES`)

This is a **native** EmDash plugin. It is registered under `plugins` and runs with
the site's authority, because it needs the R2 and Images bindings and ships Astro
components. EmDash's plugin registry distributes only sandboxed plugins, so this
package is distributed through npm.

The registry entry for this plugin (`registry/` in this repository) is a separate
sandboxed listing. Installing it adds one admin page that links here and does
nothing else. It does not install or enable this package.

## Install

```sh
npm install emdash-plugin-r2-variants
```

Add a second R2 bucket for the resized copies in `wrangler.jsonc`:

```jsonc
"r2_buckets": [
	{ "binding": "MEDIA", "bucket_name": "my-site-media" },
	{ "binding": "IMAGE_VARIANTS", "bucket_name": "my-site-variants" }
]
```

Register the plugin in `astro.config.mjs`:

```js
import { r2 } from "@emdash-cms/cloudflare";
import emdash from "emdash/astro";
import { r2Variants } from "emdash-plugin-r2-variants";

export default defineConfig({
	integrations: [
		emdash({
			storage: r2({ binding: "MEDIA" }),
			plugins: [
				r2Variants({
					binding: "MEDIA",
					variantsBinding: "IMAGE_VARIANTS",
					publicUrl: "https://images.example.com",
				}),
			],
		}),
	],
});
```

### Keep the media bucket private

Give the variants their own bucket and attach the public domain only to that
bucket. A public domain on the media bucket would expose every object in it: the
full-size originals, which may carry EXIF location data, and EmDash's private
`transfers/` folder of import and export files. EmDash's own media route refuses
those paths, but a bucket domain bypasses the route.

Without `variantsBinding`, the copies are stored in the media bucket under
`_variants/`. Where visitors load them from depends on `publicUrl`:

| `variantsBinding` | `publicUrl` | Copies stored in | Visitors load them from                              |
| ----------------- | ----------- | ---------------- | ---------------------------------------------------- |
| set               | set         | variants bucket  | the variants bucket's public domain, with no Worker  |
| set               | not set     | —                | the plugin refuses to start                          |
| not set           | not set     | media bucket     | EmDash's media route, through the Worker             |
| not set           | set         | media bucket     | the media bucket's public domain (unsafe, see below) |

The first row is the recommended setup.

With neither option set, the media bucket stays private. Each image view still
runs the Worker and reads from R2, though it never resizes. EmDash's media route
sends `Cache-Control: max-age=0, must-revalidate`, so browsers check each image
again on every page load. This mode suits local development.

The last row works only if the media bucket has a public domain, which exposes
every file in it as described above. Don't use it.

In templates, import `Image` from the plugin instead of from `emdash/ui`. It takes
the same props.

```astro
---
import { Image } from "emdash-plugin-r2-variants/astro";
---
<Image image={post.data.featured_image} width={960} />
```

## Options

| Option            | Default                       | Description                                                                                                  |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `binding`         | `"MEDIA"`                     | R2 binding that EmDash stores media in.                                                                            |
| `variantsBinding` | media bucket                  | R2 binding for the resized copies. Requires `publicUrl`.                                                           |
| `publicUrl`       | `""`                          | `https://` custom domain attached to the variants bucket. When empty, EmDash's media route serves the copies through the Worker. |
| `widths`          | `[320, 640, 960, 1280, 1920]` | Widths to create, up to 4000. Widths larger than the original are skipped, and the original width is always added. |
| `format`          | `"webp"`                      | `"webp"` or `"avif"`.                                                                                        |
| `quality`         | `85`                          | Encoder quality.                                                                                             |

## Production setup

1. Create the variants bucket. In the Cloudflare dashboard, connect a custom domain
   to it (for example `images.example.com`) and set it as `publicUrl`. Avoid `r2.dev`
   URLs, which are rate limited. Leave the media bucket without any public access.
2. Add a Cache Rule for that hostname that caches everything with a long edge TTL.
   Each variant URL contains the original's etag, so the file behind a URL never
   changes.
3. Add a cron trigger to `wrangler.jsonc` so EmDash's scheduled handler runs plugin
   jobs, for example `"triggers": { "crons": ["* * * * *"] }`.

## Capabilities

| Capability   | Used by                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------- |
| `media:read` | The `media:afterUpload` hook, which schedules the daily cleanup job. EmDash requires this capability for that hook. |

The plugin declares no allowed hosts and makes no network requests.

Capabilities gate only the `ctx` APIs that EmDash passes to the plugin. As a
native plugin, this code also has access to everything the site's Worker has,
including all bindings and environment variables. That access is why the
plugin can read and write R2 directly. Review it as you would the site's own
code.

## Security

- Storage keys are read from content, so the plugin accepts only keys that
  EmDash's own media route would serve (`isSafeTransformKey` from EmDash). Files
  in private folders such as `transfers/` are never resized or published.
- Focal points and placeholder colours also come from content. Only numbers from
  0 to 1 and hex colours reach the `style` attribute.
- WebP and AVIF output carries no EXIF metadata, so GPS data in originals never
  reaches the public copies.
- Originals larger than 25 MB, and formats other than JPEG, PNG, WebP and AVIF,
  are not resized. EmDash renders them as before.
- The plugin adds no routes. Resizing happens only for images that content
  references, when a page renders.
- Options are checked when `astro.config.mjs` loads. `publicUrl` must use
  `https://`.

## Verify it works

1. Open a page with images twice. The second time, the `<img>` `src` and `srcset`
   point at `/_variants/.../<width>.webp`, on your `publicUrl` domain if one is set.
2. List the variants bucket: `wrangler r2 object list <variants-bucket> --prefix _variants/`.
3. After the first media upload, the dashboard's scheduled tasks include
   `r2-variants` / `cleanup`.

## Costs

- Each width is resized once per version of an image, rather than once a month or
  once per data centre.
- With `publicUrl` set, visitors' image requests are served by R2 and the Cloudflare
  cache, without a Worker invocation.
- Each page render makes two R2 reads per image: one for the manifest and one for
  the original's metadata. Caching rendered pages keeps this small.

## Limitations

- These are rendered by EmDash as before: linked images in body content, gallery
  blocks, and images from external media providers.
- If a site passes its own `image` component to `<PortableText>`, that component
  takes precedence over the plugin's.
- Pages served from stored files show the dominant-colour placeholder. They do not
  show the blurhash placeholder.
- SVG and GIF files are served unchanged.
- Cloudflare only: resizing uses the Images binding.

## Development

```sh
npm test   # node --test; needs no Cloudflare account
```

| Path                       | Contents                                                       |
| -------------------------- | -------------------------------------------------------------- |
| `src/index.js`             | Plugin descriptor for `astro.config.mjs`. Safe to load in Node. |
| `src/plugin.js`            | Runtime plugin: hooks and the cleanup job.                     |
| `src/variants.js`          | Resize, manifest, cleanup and `srcset` logic, with tests.      |
| `src/runtime.js`           | Worker bindings shared by the components.                      |
| `src/astro/`               | `Image`, the Portable Text `ImageBlock`, and `blockComponents`.  |

## License

MIT
