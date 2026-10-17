R2 Image Variants resizes each media image once with the Cloudflare Images binding, stores the copies in R2, and renders `srcset` URLs that point at them.

**This Registry listing is not the plugin.** Installing it from the Registry adds one information page to the admin and nothing else. R2 Image Variants itself is a native plugin, installed from npm:

```sh
npm install emdash-plugin-r2-variants
```

## Why it must be native

The Registry lists sandboxed plugins only, and this plugin can't run in the sandbox. It reads and writes R2 through the site's bindings, resizes with the Images binding, and ships Astro components (`Image` and a Portable Text image block) that replace how images render. Those need a native plugin, registered in `plugins: []` in `astro.config.mjs`.

## Links

- [npm](https://www.npmjs.com/package/emdash-plugin-r2-variants)
- [GitHub](https://github.com/rjstech2020/emdash-plugin-r2-variants)
