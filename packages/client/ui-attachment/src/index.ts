/** Host half of the browser-only attachment atoms package. */

/** No host-side behavior; the client half exports the React atoms. */
export function apply(): void {}

// Type-only re-exports keep the package root usable for type imports without
// pulling the React components (and their CSS) into the Node loader.
export type { AttachmentRailItem, AttachmentRailLabels } from './AttachmentRail.tsx'
export type { FileChipLabels, FileChipValue } from './FileChip.tsx'
export type { DropOverlayLabels } from './DropOverlay.tsx'
export type { ImageLightboxLabels } from './ImageLightbox.tsx'
export type { ImageLoader, MessageImageLabels } from './MessageImage.tsx'
