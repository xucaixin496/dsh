import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { FileAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import { readFileFile, saveFileFile, validateFileFile } from '../src/store.ts'

const TEXT = Uint8Array.from(Buffer.from('hello attachment world'))
const LIMITS: FileAttachmentLimits = {
  maxFileBytes: 1024,
  maxFilesPerMessage: 2,
  maxMessageFileBytes: 2048,
}

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-file-attachment-'))
  roots.push(value)
  return join(value, 'attachments', 'v1')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('local file attachment store', () => {
  it('saves and reads a file with verified bytes', async () => {
    const storageRoot = await root()
    const ref = await saveFileFile(storageRoot, { data: TEXT, mediaType: 'text/plain', name: 'note.txt' }, LIMITS)
    expect(ref.mediaType).toBe('text/plain')
    expect(ref.bytes).toBe(TEXT.byteLength)
    expect(ref.name).toBe('note.txt')
    expect(String(ref.attachmentId)).toBe(`sha256:${createHash('sha256').update(TEXT).digest('hex')}`)
    const stored = await readFileFile(storageRoot, ref)
    expect(stored.ref).toEqual(ref)
    expect(stored.data).toEqual(TEXT)
  })

  it('deduplicates identical bytes under one content address', async () => {
    const storageRoot = await root()
    const first = await saveFileFile(storageRoot, { data: TEXT, mediaType: 'text/plain' }, LIMITS)
    const second = await saveFileFile(storageRoot, { data: TEXT, mediaType: 'text/plain', name: 'copy.txt' }, LIMITS)
    expect(String(second.attachmentId)).toBe(String(first.attachmentId))
  })

  it('strips path components and control characters from display names', async () => {
    const storageRoot = await root()
    const ref = await saveFileFile(
      storageRoot,
      { data: TEXT, mediaType: 'text/plain', name: 'C:\\Users\\x\\..\\..\\secret\\.\u0000bad name.txt' },
      LIMITS,
    )
    expect(ref.name).toBe('.bad name.txt')
  })

  it('enforces byte, media-type, and magic policies', async () => {
    const storageRoot = await root()
    await expect(saveFileFile(storageRoot, { data: new Uint8Array(2048), mediaType: 'text/plain' }, LIMITS))
      .rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    await expect(saveFileFile(storageRoot, { data: Uint8Array.of(1), mediaType: 'video/mp4' }, LIMITS))
      .rejects.toMatchObject({ code: 'FILE_DENIED_MEDIA_TYPE' })
    await expect(saveFileFile(storageRoot, { data: Uint8Array.of(0x49, 0x44, 0x33, 0x00), mediaType: 'application/octet-stream' }, LIMITS))
      .rejects.toMatchObject({ code: 'FILE_DENIED_MEDIA_TYPE' })
    await expect(validateFileFile({ data: TEXT, mediaType: 'text/plain' }, LIMITS)).resolves.toBeUndefined()
  })

  it('rejects a missing object and a corrupted object', async () => {
    const storageRoot = await root()
    const ref = await saveFileFile(storageRoot, { data: TEXT, mediaType: 'text/plain' }, LIMITS)
    await expect(readFileFile(storageRoot, { ...ref, attachmentId: ref.attachmentId, bytes: ref.bytes })).resolves.toBeDefined()

    const missing = { ...ref, attachmentId: AttachmentId('sha256:' + 'a'.repeat(64)) }
    await expect(readFileFile(storageRoot, missing)).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' })

    // Overwrite the stored object with different bytes: digest verification must fail.
    const sha256 = String(ref.attachmentId).slice('sha256:'.length)
    await writeFile(join(storageRoot, 'objects', sha256.slice(0, 2), sha256), 'tampered')
    await expect(readFileFile(storageRoot, ref)).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
  })

  it('rejects a reference whose byte count no longer matches', async () => {
    const storageRoot = await root()
    const ref = await saveFileFile(storageRoot, { data: TEXT, mediaType: 'text/plain' }, LIMITS)
    await expect(readFileFile(storageRoot, { ...ref, bytes: ref.bytes + 1 }))
      .rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
  })
})
