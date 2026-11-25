import {
  PRODUCT_SURFACE_EVENT,
  type ProductAttachmentKind,
  productAttachmentSize,
} from "@repo/features/analytics";
import { appPlatform } from "./app-platform.js";

/**
 * attachment-too-large.ts -- counts a file refused for its size, once, where the refusal is decided.
 *
 * What travels is the file's kind and its size on a rung
 * (`productAttachmentSize`): never its name, its type, or the box that was
 * handed it. Note that a caller counts at the place that says the file is too
 * large, never where a refusal's words are drawn again, because a redraw
 * would count the same file twice.
 */
export function countAttachmentTooLarge(kind: ProductAttachmentKind, bytes: number): void {
  appPlatform().recordSurfaceEvent(PRODUCT_SURFACE_EVENT.ATTACHMENT_TOO_LARGE, {
    kind,
    size_bucket: productAttachmentSize(bytes),
  });
}
