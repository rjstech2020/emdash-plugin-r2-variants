# AGENTS.md

Rules for anyone, human or AI agent, changing this plugin. Read them before you
edit, and check every item under "Before you commit" afterwards.

## What the plugin is

A native EmDash plugin for Cloudflare sites. It resizes each media image once
with the Images binding, stores the copies in R2, and renders `srcset` URLs that
point at them. See `README.md` for behaviour and setup.

| File                       | Role                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `src/index.js`             | Descriptor for `astro.config.mjs`. Runs in Node.                       |
| `src/plugin.js`            | Runtime plugin: hooks and the cleanup cron job.                        |
| `src/variants.js`          | All logic that can be tested without Cloudflare: options, resize, manifest, cleanup, `srcset`, `<img>` attributes. |
| `src/runtime.js`           | The only module that touches `env` and `waitUntil` for the components. |
| `src/astro/`               | `Image`, the Portable Text `ImageBlock`, and `blockComponents`.        |
| `src/variants.test.js`     | `node --test` suite with in-memory R2 and Images fakes.                |

## Security rules

These protect the EmDash site the plugin runs in. A change that weakens one of
them needs an explicit reason in the commit message.

1. **Treat content as untrusted.** Media values, Portable Text nodes and their
   fields (`storageKey`, `url`, `dominantColor`, `focalX`, `alignment`, display
   sizes) can be written by any editor or by an import.
2. **Validate storage keys with EmDash's guard.** Every key must pass
   `isSafeKey` (EmDash's `isSafeTransformKey`) before it reaches a bucket. This
   keeps private folders such as `transfers/` from being resized and published.
3. **Never put raw content into `style`, `class` or URLs.** Use allowlists or
   strict patterns, as `imgAttrs` does for colours and focal points and
   `ImageBlock` does for alignment. Astro escapes attribute values, but that does
   not stop CSS injection inside a `style` value.
4. **Keep originals private.** The plugin reads from the media bucket and writes
   only under `_variants/` in the variants bucket. Never write, list or delete
   anything else in the media bucket.
5. **Bound the work.** Keep the source size cap, the resizable-format allowlist,
   the width limit (`MAX_TRANSFORM_DIMENSION`) and the per-isolate dedupe of
   resize jobs. Resizing must only be triggered by rendering content.
6. **Add no routes.** A public endpoint would let anyone trigger resizes or read
   objects. If one becomes necessary, design it as a separate, reviewed change.
7. **No metadata leaks.** Output formats must strip EXIF (WebP and AVIF do).
   Adding JPEG or PNG output needs a check of what metadata survives.
8. **Validate options at config load.** New options go through `validate()` in
   `variants.js`, so a bad setup fails the build.
9. **Log nothing sensitive.** Storage keys and error objects are fine. Never log
   bytes, bindings, secrets or request headers.

## Code rules

1. **Reuse EmDash first.** Before writing a helper or constant, check what
   `emdash`, `emdash/ui` and `emdash/media/image-endpoint` export (look in
   `node_modules/emdash/dist/**/*.d.mts`). Import it. Copy EmDash code only when
   no export exists, and say so in a comment, as `ImageBlock.astro` does for its
   scoped CSS.
2. **Use public exports only.** Never import `emdash/src/...` or other internal
   paths. They can change in any release.
3. **One place per concern.** Option checks live in `validate()`. Binding access
   lives in `runtime.js`. Path layout lives in `variants.js`. Don't repeat any of
   them elsewhere.
4. **Keep `index.js` and `variants.js` free of `cloudflare:workers`.** Both load
   in Node: `index.js` from `astro.config.mjs`, `variants.js` in tests.
5. **Fall back, never break.** If variants are missing or anything fails, render
   EmDash's own component. A page must never show a broken image because of this
   plugin.
6. **Keep variant URLs immutable.** The original's etag is part of every path.
   Anything that changes a copy's bytes, such as format or quality, must also
   change its URL or be detected as stale by the manifest check.
7. **Write the manifest last.** It is the signal that every listed copy exists.
8. **Keep it small.** No abstractions with one user, no options without a real
   need, no dependencies beyond the peers.

## Before you commit

Run these from the site that uses the plugin, unless noted.

- [ ] `npm test` in this package passes. Every new branch or security rule has
      a test.
- [ ] `npx astro check` reports 0 errors.
- [ ] `npx astro build` completes.
- [ ] In `astro dev`, pages with images return 200, and the second render's
      `<img>` tags point at `_variants/.../<width>.webp`.
- [ ] One variant URL returns 200 with `content-type: image/webp`.
- [ ] Rendering pages adds no new errors to `npx astro dev logs`.
- [ ] Search the diff for raw content values in `style`, `class` or URL strings.
- [ ] Search the diff for EmDash internals copied in when an export exists.
- [ ] Look at the built CSS (`dist/client/_astro/*.css`) for rules the plugin
      now ships twice.
- [ ] For a runtime change, the cleanup job still works: plant an orphan under
      `_variants/`, make the `r2-variants` task due, trigger
      `/cdn-cgi/handler/scheduled`, and check the log reports it removed.
- [ ] `README.md`, `src/index.d.ts` and `CHANGELOG.md` match the change.

## Writing style for README and comments

- Plain descriptive headings ("Install", "Options", "Security").
- No slogans, paired phrases for rhythm, or "X, not Y" constructions.
- State facts the code or Cloudflare's docs support. No savings figures or
  claims that depend on a site's traffic.
- Comments explain why, not what.

## Releasing

- Bump `version` in `package.json`, `src/index.js` and `src/plugin.js` together.
- Add a `CHANGELOG.md` entry.
- `npm pack --dry-run` lists only `src/` (no tests), `README.md`, `LICENSE`,
  `CHANGELOG.md` and `package.json`.
