# emdash-plugin-r2-variants

## 0.1.1

- Docs only, no code changes. The README now lists the declared capability
  (`media:read`) and explains the native trust boundary, as EmDash's guide to
  distributing native plugins asks.

## 0.1.0

- First release: `Image` component, Portable Text `image` block, dark-mode
  variants, and a daily cleanup job.
- `variantsBinding` option: store resized copies in a separate public bucket so
  the media bucket stays private.
- Security: accept only storage keys EmDash itself would serve, validate focal
  points and colours from content, skip originals over 25 MB, validate options.
- Uses EmDash's exported helpers and constants instead of copies. Removed the
  `prefix` option.
- Capabilities: declares `media:read`, which EmDash requires for the
  `media:afterUpload` hook that schedules cleanup. No allowed hosts.
