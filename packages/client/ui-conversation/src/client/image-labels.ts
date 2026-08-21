/** Attachment error and limit copy owned by the conversation input flow. */

import type {
  AttachmentRailLabels, DropOverlayLabels, FileChipLabels, ImageLightboxLabels, MessageImageLabels,
} from '@deepseek-ai/dsh-client-ui-attachment/client'
import type { FileAttachmentLimits, ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationKey } from './locales.ts'

/**
 * Byte count as user-facing megabytes (`10MB`, `2.5MB`).
 * @param bytes - the byte count.
 * @returns the rounded megabyte text.
 */
export function imageSizeText(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? String(mb) : mb.toFixed(1)}MB`
}

/**
 * Product copy for a host attachment rejection (the `attachment-error`
 * `details.reason`). User-solvable reasons name the limit and the way out;
 * reasons the user cannot act on fold into one send-failed line carrying the
 * reason code for a bug report.
 * @param t - the conversation-namespace translate.
 * @param reason - the wire `details.reason` code.
 * @param limits - projected limits interpolated into count/size copy, when known.
 * @returns the banner text.
 */
export function attachmentErrorText(
  t: Translate<ConversationKey>,
  reason: string,
  limits?: ImageAttachmentLimits,
  fileLimits?: FileAttachmentLimits,
): string {
  switch (reason) {
    case 'MODEL_DOES_NOT_SUPPORT_IMAGES': return t('image.modelUnsupported')
    case 'SUBAGENT_IMAGE_UNSUPPORTED': return t('image.subagentUnsupported')
    case 'IMAGE_TOO_MANY_PIXELS': return t('image.tooManyPixels')
    case 'IMAGE_DIMENSION_TOO_LARGE':
      if (limits !== undefined) return t('image.dimensionTooLarge', { size: limits.maxImageDimension })
      break
    // Undecodable bytes or a declared type its bytes contradict: solvable by
    // replacing or re-exporting the file, so it reads as a format problem.
    case 'INVALID_IMAGE':
    case 'IMAGE_TYPE_MISMATCH':
      return t('image.unsupportedType')
    case 'TOO_MANY_IMAGES':
      if (limits !== undefined) return t('image.tooMany', { count: limits.maxImagesPerMessage })
      break
    case 'IMAGE_TOO_LARGE':
      if (limits !== undefined) return t('image.fileTooLarge', { size: imageSizeText(limits.maxImageBytes) })
      break
    case 'IMAGES_TOO_LARGE':
      if (limits !== undefined) return t('image.totalTooLarge', { size: imageSizeText(limits.maxMessageImageBytes) })
      break
    case 'FILE_DENIED_MEDIA_TYPE':
    case 'INVALID_FILE':
      return t('file.unsupportedType')
    case 'TOO_MANY_FILES':
      if (fileLimits !== undefined) return t('file.tooMany', { count: fileLimits.maxFilesPerMessage })
      break
    case 'FILE_TOO_LARGE':
      if (fileLimits !== undefined) return t('file.fileTooLarge', { size: imageSizeText(fileLimits.maxFileBytes) })
      break
    case 'FILES_TOO_LARGE':
      if (fileLimits !== undefined) return t('file.totalTooLarge', { size: imageSizeText(fileLimits.maxMessageFileBytes) })
      break
    default: break
  }
  return t('image.sendFailed', { reason })
}

/**
 * Resolve the original-image lightbox strings.
 * @param t - the conversation-namespace translate.
 * @returns the lightbox dialog and close-control labels.
 */
export function lightboxLabels(t: Translate<ConversationKey>): ImageLightboxLabels {
  return { dialog: t('image.preview'), close: t('image.closePreview') }
}

/**
 * Resolve the chat-history image strings.
 * @param t - the conversation-namespace translate.
 * @returns the message-image labels including the forwarded lightbox strings.
 */
export function messageImageLabels(t: Translate<ConversationKey>): MessageImageLabels {
  return {
    image: t('image.label'),
    open: t('image.openOriginal'),
    openNamed: label => t('image.openOriginalLabel', { label }),
    loading: t('image.loading'),
    loadFailed: t('image.loadFailed'),
    lightbox: lightboxLabels(t),
  }
}

/**
 * Resolve the chat-history file-attachment strings.
 * @param t - the conversation-namespace translate.
 * @returns the file-chip download label.
 */
export function messageFileLabels(t: Translate<ConversationKey>): FileChipLabels {
  return { download: t('file.download') }
}

/**
 * Resolve the full-page drop overlay strings.
 * @param t - the conversation-namespace translate.
 * @param accepting - whether drops are currently accepted.
 * @param limits - per-message limits for the desc line, when known.
 * @returns the overlay title, with the limits desc while accepting.
 */
export function dropOverlayLabels(
  t: Translate<ConversationKey>,
  accepting: boolean,
  limits?: { count: number; size: string },
): DropOverlayLabels {
  if (!accepting) return { title: t('image.dropBlocked') }
  return {
    title: t('image.dropTitle'),
    desc: limits === undefined ? undefined : t('image.dropDesc', { count: limits.count, size: limits.size }),
  }
}

/**
 * Resolve the composer draft-image rail strings.
 * @param t - the conversation-namespace translate.
 * @returns the rail group, open-tooltip, and paging-arrow labels.
 */
export function attachmentRailLabels(t: Translate<ConversationKey>): AttachmentRailLabels {
  return {
    group: t('image.pending'),
    open: t('image.openOriginal'),
    scrollLeft: t('image.scrollLeft'),
    scrollRight: t('image.scrollRight'),
  }
}
