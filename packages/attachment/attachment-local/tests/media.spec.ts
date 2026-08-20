import { describe, expect, it } from 'vitest'
import {
  assertFilePolicy,
  assertNotAudioVideoMagic,
  isAllowedMediaType,
  isDeniedMediaType,
  matchMediaType,
} from '../src/media.ts'
import type { FileAttachmentLimits } from '@deepseek-ai/dsh-attachment'

describe('media policy matching', () => {
  it('matches exact and wildcard patterns', () => {
    expect(matchMediaType('application/pdf', 'application/pdf')).toBe(true)
    expect(matchMediaType('application/pdf', 'application/*')).toBe(true)
    expect(matchMediaType('application/pdf', 'text/*')).toBe(false)
    expect(matchMediaType('application/pdf', '*/*')).toBe(true)
    expect(matchMediaType('application/pdf', '*')).toBe(true)
  })

  it('denies audio and video by default', () => {
    expect(isDeniedMediaType('audio/mpeg')).toBe(true)
    expect(isDeniedMediaType('video/mp4')).toBe(true)
    expect(isDeniedMediaType('application/pdf')).toBe(false)
  })

  it('honours explicit deny and allow lists', () => {
    expect(isDeniedMediaType('video/mp4', ['video/*'])).toBe(true)
    expect(isDeniedMediaType('audio/mpeg', [])).toBe(false)
    expect(isAllowedMediaType('application/pdf', ['application/*'])).toBe(true)
    expect(isAllowedMediaType('image/png', ['application/*'])).toBe(false)
    expect(isAllowedMediaType('application/pdf', undefined)).toBe(true)
    expect(isAllowedMediaType('application/pdf', [])).toBe(true)
  })
})

describe('audio/video magic guard', () => {
  it('rejects common audio and video containers', () => {
    expect(() => assertNotAudioVideoMagic(Uint8Array.of(0x49, 0x44, 0x33, 0x04))).toThrow(/not accepted/)
    expect(() => assertNotAudioVideoMagic(Uint8Array.of(0x4f, 0x67, 0x67, 0x53, 0x00))).toThrow(/not accepted/)
    const wav = Uint8Array.of(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45)
    expect(() => assertNotAudioVideoMagic(wav)).toThrow(/not accepted/)
    const mp4 = Uint8Array.of(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20)
    expect(() => assertNotAudioVideoMagic(mp4)).toThrow(/not accepted/)
    expect(() => assertNotAudioVideoMagic(Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3))).toThrow(/not accepted/)
  })

  it('exempts WebP and arbitrary binary data', () => {
    const webp = Uint8Array.from(Buffer.from('RIFFxxxxWEBPVP8 ', 'latin1'))
    expect(() => assertNotAudioVideoMagic(webp)).not.toThrow()
    expect(() => assertNotAudioVideoMagic(Uint8Array.of(0x50, 0x4b, 0x03, 0x04))).not.toThrow()
    expect(() => assertNotAudioVideoMagic(Uint8Array.of(1, 2, 3))).not.toThrow()
  })
})

describe('file policy', () => {
  const LIMITS: FileAttachmentLimits = {
    maxFileBytes: 1024,
    maxFilesPerMessage: 2,
    maxMessageFileBytes: 2048,
  }

  function errorCode(fn: () => void): string | undefined {
    try {
      fn()
      return undefined
    } catch (error) {
      return (error as { code?: string }).code
    }
  }

  it('rejects empty files, oversized files, and denied media types', () => {
    expect(errorCode(() => assertFilePolicy({ data: new Uint8Array(0), mediaType: 'text/plain' }, LIMITS))).toBe('INVALID_FILE')
    expect(errorCode(() => assertFilePolicy({ data: new Uint8Array(2048), mediaType: 'text/plain' }, LIMITS))).toBe('FILE_TOO_LARGE')
    expect(errorCode(() => assertFilePolicy({ data: Uint8Array.of(1), mediaType: 'video/mp4' }, LIMITS))).toBe('FILE_DENIED_MEDIA_TYPE')
    expect(errorCode(() => assertFilePolicy({ data: Uint8Array.of(0x49, 0x44, 0x33, 0x00), mediaType: 'application/octet-stream' }, LIMITS)))
      .toBe('FILE_DENIED_MEDIA_TYPE')
  })

  it('admits text, documents, archives, and other non-media types', () => {
    expect(() => assertFilePolicy({ data: Uint8Array.from(Buffer.from('hello')), mediaType: 'text/plain' }, LIMITS)).not.toThrow()
    expect(() => assertFilePolicy({ data: Uint8Array.of(0x25, 0x50, 0x44, 0x46), mediaType: 'application/pdf' }, LIMITS)).not.toThrow()
    expect(() => assertFilePolicy({ data: Uint8Array.of(0x50, 0x4b, 0x03, 0x04), mediaType: 'application/zip' }, LIMITS)).not.toThrow()
  })
})
