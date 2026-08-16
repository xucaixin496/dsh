/** Local durable attachment backend rooted below `DSH_HOME`. @module @deepseek-ai/dsh-attachment-local */

import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  FileAttachmentLimits,
  FileAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveFileAttachment,
  SaveImageAttachment,
  StoredFileAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { readFileFile, readImageFile, saveFileFile, saveImageFile, validateFileFile, validateImageFile } from './store.ts'

export { detectImage } from './image.ts'
export { readFileFile, readImageFile, saveFileFile, saveImageFile, validateFileFile, validateImageFile } from './store.ts'

/** Default maximum encoded bytes for one image. */
export const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** Default maximum images in one prompt. */
export const DEFAULT_MAX_IMAGES_PER_MESSAGE = 20
/** Default maximum aggregate image bytes in one prompt. */
export const DEFAULT_MAX_MESSAGE_IMAGE_BYTES = 100 * 1024 * 1024
/** Default maximum intrinsic pixels for one image. */
export const DEFAULT_MAX_IMAGE_PIXELS = 40_000_000
/** Default maximum encoded bytes for one generic file. */
export const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024
/** Default maximum generic files in one prompt. */
export const DEFAULT_MAX_FILES_PER_MESSAGE = 20
/** Default maximum aggregate generic-file bytes in one prompt. */
export const DEFAULT_MAX_MESSAGE_FILE_BYTES = 200 * 1024 * 1024

/** Local attachment backend configuration. */
export interface Config {
  /** Explicit harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /** Maximum encoded bytes accepted for one image. */
  maxImageBytes?: number
  /** Maximum image count accepted in one submitted message. */
  maxImagesPerMessage?: number
  /** Maximum aggregate encoded image bytes accepted in one submitted message. */
  maxMessageImageBytes?: number
  /** Maximum intrinsic width multiplied by height accepted for one image. */
  maxImagePixels?: number
  /** Maximum encoded bytes accepted for one generic file. */
  maxFileBytes?: number
  /** Maximum generic-file count accepted in one submitted message. */
  maxFilesPerMessage?: number
  /** Maximum aggregate generic-file bytes accepted in one submitted message. */
  maxMessageFileBytes?: number
  /** Optional explicit generic-file media-type allow list. */
  allowedMediaTypes?: string[]
  /** Generic-file media-type deny list; defaults to audio/video. */
  denyMediaTypes?: string[]
}

/** Persistent content-addressed local attachment store. */
export class LocalAttachmentStore extends AttachmentStore {
  static Config: z<Config> = z.object({
    dshHome: z.string(),
    maxImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_BYTES),
    maxImagesPerMessage: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGES_PER_MESSAGE),
    maxMessageImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_IMAGE_BYTES),
    maxImagePixels: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_PIXELS),
    maxFileBytes: z.number().step(1).min(1).default(DEFAULT_MAX_FILE_BYTES),
    maxFilesPerMessage: z.number().step(1).min(1).default(DEFAULT_MAX_FILES_PER_MESSAGE),
    maxMessageFileBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_FILE_BYTES),
    allowedMediaTypes: z.array(z.string()).default([]),
    denyMediaTypes: z.array(z.string()).default(['audio/*', 'video/*']),
  })

  /** Absolute versioned storage root. */
  readonly root: string
  readonly imageLimits: ImageAttachmentLimits
  readonly fileLimits: FileAttachmentLimits

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.root = resolve(join(resolveDshHome(config.dshHome), 'attachments', 'v1'))
    this.imageLimits = Object.freeze({
      maxImageBytes: config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
      maxImagesPerMessage: config.maxImagesPerMessage ?? DEFAULT_MAX_IMAGES_PER_MESSAGE,
      maxMessageImageBytes: config.maxMessageImageBytes ?? DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
      maxImagePixels: config.maxImagePixels ?? DEFAULT_MAX_IMAGE_PIXELS,
      mediaTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const),
    })
    const denyMediaTypes = config.denyMediaTypes ?? ['audio/*', 'video/*']
    const allowedMediaTypes = config.allowedMediaTypes
    this.fileLimits = Object.freeze({
      maxFileBytes: config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
      maxFilesPerMessage: config.maxFilesPerMessage ?? DEFAULT_MAX_FILES_PER_MESSAGE,
      maxMessageFileBytes: config.maxMessageFileBytes ?? DEFAULT_MAX_MESSAGE_FILE_BYTES,
      ...(allowedMediaTypes !== undefined && allowedMediaTypes.length > 0
        ? { allowedMediaTypes: Object.freeze([...allowedMediaTypes]) }
        : {}),
      denyMediaTypes: Object.freeze([...denyMediaTypes]),
    })
  }

  async validateImage(input: SaveImageAttachment): Promise<void> {
    await validateImageFile(input, this.imageLimits)
  }

  async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return saveImageFile(this.root, input, this.imageLimits)
  }

  async readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> {
    return readImageFile(this.root, ref, signal)
  }

  async validateFile(input: SaveFileAttachment): Promise<void> {
    await validateFileFile(input, this.fileLimits)
  }

  async saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef> {
    return saveFileFile(this.root, input, this.fileLimits)
  }

  async readFile(ref: FileAttachmentRef, signal?: AbortSignal): Promise<StoredFileAttachment> {
    return readFileFile(this.root, ref, signal)
  }
}

export default LocalAttachmentStore
