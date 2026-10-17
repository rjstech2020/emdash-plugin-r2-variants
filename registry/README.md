# R2 Image Variants registry listing

The sandboxed EmDash Registry entry for
[`emdash-plugin-r2-variants`](../README.md). Installing it from the Registry adds
one admin page that points to the native plugin on npm. It does not install,
enable or trust that package; operators install it with
`npm install emdash-plugin-r2-variants` and register it in `astro.config.mjs`.

It requests no capabilities, allowed hosts or storage, and has only the `admin`
route that Block Kit pages need.

This package is versioned separately from the npm package. Listing text never
states the npm package's version.

## Publish

Run from this directory as the account in `publisher`
(`rajatag.bsky.social`):

```sh
npm install
npm test
npx emdash-plugin login rajatag.bsky.social
npx emdash-plugin publish
```

Bump `version` in `package.json` before each new release. Releases are
immutable. Profile fields (name, description, sections) are set by the first
publish; change them later with `npx emdash-plugin update-package`.
