/**
 * Astro components for sites using the plugin.
 *
 * `blockComponents` is the plugin's componentsEntry: EmDash merges it over its
 * own Portable Text components, so body-content images need no template change.
 *
 * @example
 * ```astro
 * ---
 * import { Image } from "emdash-plugin-r2-variants/astro";
 * ---
 * <Image image={post.data.featured_image} width={960} />
 * ```
 */
import ImageComponent from "./Image.astro";
import ImageBlockComponent from "./ImageBlock.astro";

export const blockComponents = { image: ImageBlockComponent };

export { ImageComponent as Image, ImageBlockComponent as ImageBlock };
