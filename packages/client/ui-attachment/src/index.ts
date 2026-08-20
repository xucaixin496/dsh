/** Host half of the browser-only attachment presentation plugin. */

export { AttachmentRail } from './AttachmentRail.tsx'
export type { AttachmentRailItem, AttachmentRailLabels } from './AttachmentRail.tsx'
export { FileChip } from './FileChip.tsx'
export type { FileChipLabels, FileChipValue } from './FileChip.tsx'
export { DropOverlay } from './DropOverlay.tsx'
export type { DropOverlayLabels } from './DropOverlay.tsx'
export { ImageLightbox } from './ImageLightbox.tsx'
export type { ImageLightboxLabels } from './ImageLightbox.tsx'
export { ImageGallery, MessageImage } from './MessageImage.tsx'
export type { ImageLoader, MessageImageLabels } from './MessageImage.tsx'
/** No host-side behavior; the client half registers the React slot entries. */
export function apply(): void {}
