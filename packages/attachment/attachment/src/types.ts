/** Durable attachment vocabulary. @module @deepseek-ai/dsh-attachment/types */

import type { AttachmentId } from './brand.ts'

export type { AttachmentId } from './brand.ts'

/** Raster image formats accepted by the version-one attachment path. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/**
 * Any media type accepted by the generic file attachment path. Audio and
 * video types are refused by policy (`FileAttachmentLimits.denyMediaTypes`),
 * not by this type, so deployments may relax or extend the policy.
 */
export type FileMediaType = string

/** Durable, serializable metadata for one immutable image object. */
export interface ImageAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type verified from the stored bytes. */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Intrinsic encoded width in pixels. */
  width: number
  /** Intrinsic encoded height in pixels. */
  height: number
  /** Optional display name stripped of local path information. */
  name?: string
}

/** Deployment-resolved limits used by upload admission and request buffering. */
export interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  /** Maximum intrinsic width and maximum intrinsic height in pixels for one image. */
  maxImageDimension: number
  mediaTypes: readonly ImageMediaType[]
}

/** Base64-encoded image upload accompanying one wire request. */
export interface EncodedImageAttachment {
  /** Declared media type, verified against the decoded bytes during admission. */
  mediaType: ImageMediaType
  /** Canonical base64 encoding of the image bytes. */
  data: string
  /** Optional display name; it is never interpreted as a path. */
  name?: string
}

/** Request to validate and durably commit one image. */
export interface SaveImageAttachment {
  data: Uint8Array
  /** Caller-declared media type, checked against fully decoded bytes. */
  mediaType: ImageMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
}

/** Stored image bytes returned after reference and digest verification. */
export interface StoredImageAttachment {
  ref: ImageAttachmentRef
  data: Uint8Array
}

/** Durable, serializable metadata for one immutable non-image file object. */
export interface FileAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type verified by the configured admission policy. */
  mediaType: FileMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Optional display name stripped of local path information. */
  name?: string
}

/** Deployment-resolved limits used by file upload admission. */
export interface FileAttachmentLimits {
  /** Maximum encoded bytes accepted for one file. */
  maxFileBytes: number
  /** Maximum file count accepted in one submitted message. */
  maxFilesPerMessage: number
  /** Maximum aggregate encoded file bytes accepted in one submitted message. */
  maxMessageFileBytes: number
  /**
   * Optional explicit allow list. When present, a declared media type must
   * match one entry (`type/subtype` or `type/*`); an empty array means every
   * type that is not denied is accepted.
   */
  allowedMediaTypes?: readonly string[]
  /**
   * Media types refused regardless of the allow list (`audio/*`, `video/*`,
   * exact `type/subtype`). Audio/video defaults are supplied by the local
   * store so a mis-declared container is still caught by the magic guard.
   */
  denyMediaTypes?: readonly string[]
}

/** Request to validate and durably commit one non-image file. */
export interface SaveFileAttachment {
  data: Uint8Array
  /** Caller-declared media type, checked against the deployment policy. */
  mediaType: FileMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
}

/** Stored file bytes returned after reference and digest verification. */
export interface StoredFileAttachment {
  ref: FileAttachmentRef
  data: Uint8Array
}
