/** Media admission policy for generic file attachments. @module @deepseek-ai/dsh-attachment-local/media */

import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { FileAttachmentLimits } from '@deepseek-ai/dsh-attachment'

/**
 * Match one declared media type against a policy pattern. Patterns may be an
 * exact `type/subtype`, a family `type` with a wildcard subtype, or a full
 * wildcard that matches everything.
 * @param declared - caller-declared media type.
 * @param pattern - policy pattern.
 * @returns whether the declared type matches the pattern.
 */
export function matchMediaType(declared: string, pattern: string): boolean {
  const value = declared.trim().toLowerCase()
  const pat = pattern.trim().toLowerCase()
  if (pat === '*' || pat === '*/*') return true
  if (pat.endsWith('/*')) return value.startsWith(pat.slice(0, -1))
  return value === pat
}

/**
 * True when the declared media type is refused by the deny list. The default
 * policy refuses the audio and video families, matching the product decision
 * that parser coverage for those families is not viable.
 * @param declared - caller-declared media type.
 * @param denyMediaTypes - deny patterns; omitted defaults to `['audio/*', 'video/*']`.
 * @returns whether the type is denied.
 */
export function isDeniedMediaType(declared: string, denyMediaTypes?: readonly string[]): boolean {
  const deny = denyMediaTypes ?? ['audio/*', 'video/*']
  return deny.some(pattern => matchMediaType(declared, pattern))
}

/**
 * True when the declared media type passes an explicit allow list. An absent
 * or empty allow list admits every type that is not otherwise denied.
 * @param declared - caller-declared media type.
 * @param allowed - allow patterns; omitted or empty means unrestricted.
 * @returns whether the type is admitted.
 */
export function isAllowedMediaType(declared: string, allowed?: readonly string[]): boolean {
  if (allowed === undefined || allowed.length === 0) return true
  return allowed.some(pattern => matchMediaType(declared, pattern))
}

/**
 * Common audio/video container magic sequences. WEBP is deliberately absent:
 * it also starts with `RIFF`, and image admission owns WebP validation, so a
 * blanket `RIFF` deny would reject valid images.
 */
const DENIED_MAGIC: ReadonlyArray<readonly number[]> = [
  [0x49, 0x44, 0x33], // ID3 tag (MP3/AAC)
  [0x4f, 0x67, 0x67, 0x53], // OggS (Ogg containers)
  [0x66, 0x4c, 0x61, 0x43], // fLaC (FLAC)
  [0x4d, 0x54, 0x68, 0x64], // MThd (MIDI)
  [0x1a, 0x45, 0xdf, 0xa3], // Matroska / WebM / MKV
  [0x30, 0x26, 0xb2, 0x75], // ASF (WMA/WMV)
  [0xff, 0xfb], // MP3 frame sync
  [0xff, 0xf3], // MP3 frame sync (variant)
  [0xff, 0xf2], // MP3 frame sync (variant)
]

const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]
const FTYP = [0x66, 0x74, 0x79, 0x70]

function hasPrefix(data: Uint8Array, magic: readonly number[], at = 0): boolean {
  if (data.byteLength < at + magic.length) return false
  for (let i = 0; i < magic.length; i++) {
    if (data[at + i] !== magic[i]) return false
  }
  return true
}

/**
 * Reject bytes that provably belong to a common audio/video container even
 * when the caller declared a non-media type (e.g. a renamed `.mp4` shipped as
 * `application/octet-stream`). WebP and other `RIFF`-based images are exempt.
 * @param data - complete encoded bytes.
 * @throws `AttachmentError` with code `FILE_DENIED_MEDIA_TYPE` on detection.
 */
export function assertNotAudioVideoMagic(data: Uint8Array): void {
  if (hasPrefix(data, RIFF)) {
    if (hasPrefix(data, WEBP, 8)) return
    throw new AttachmentError('Audio/video container bytes are not accepted as file attachments.', 'FILE_DENIED_MEDIA_TYPE')
  }
  if (hasPrefix(data, FTYP, 4)) {
    throw new AttachmentError('Audio/video container bytes are not accepted as file attachments.', 'FILE_DENIED_MEDIA_TYPE')
  }
  for (const magic of DENIED_MAGIC) {
    if (hasPrefix(data, magic)) {
      throw new AttachmentError('Audio/video container bytes are not accepted as file attachments.', 'FILE_DENIED_MEDIA_TYPE')
    }
  }
}

/**
 * Apply the complete generic-file admission policy: non-empty bytes, per-file
 * size cap, deny/allow media-type policy, and the audio/video magic guard.
 * @param input - encoded bytes and declared media type.
 * @param limits - resolved storage policy.
 * @throws `AttachmentError` with a stable machine-routing code on refusal.
 */
export function assertFilePolicy(input: { data: Uint8Array; mediaType: string }, limits: FileAttachmentLimits): void {
  if (input.data.byteLength === 0) throw new AttachmentError('File is empty.', 'INVALID_FILE')
  if (input.data.byteLength > limits.maxFileBytes) {
    throw new AttachmentError('File exceeds the configured byte limit.', 'FILE_TOO_LARGE')
  }
  const declared = input.mediaType.trim() === '' ? 'application/octet-stream' : input.mediaType
  if (isDeniedMediaType(declared, limits.denyMediaTypes)) {
    throw new AttachmentError(`Media type "${declared}" is not accepted for file attachments.`, 'FILE_DENIED_MEDIA_TYPE')
  }
  if (!isAllowedMediaType(declared, limits.allowedMediaTypes)) {
    throw new AttachmentError(`Media type "${declared}" is not accepted for file attachments.`, 'FILE_DENIED_MEDIA_TYPE')
  }
  assertNotAudioVideoMagic(input.data)
}
