import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  FileAttachmentLimits, FileAttachmentRef, ImageAttachmentLimits, ImageAttachmentRef,
  SaveFileAttachment, SaveImageAttachment, StoredFileAttachment, StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SpillLocator, SpillStore } from '@deepseek-ai/dsh-spill'
import type { SaveTextSpill, SpillRef } from '@deepseek-ai/dsh-spill'
import { MAX_INLINE_FILE_CHARS, durablePromptContent } from '../src/api-proxy.ts'

class StubAttachmentStore extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: 1,
    maxImagePixels: 1,
    mediaTypes: ['image/png'],
  }
  readonly fileLimits: FileAttachmentLimits = {
    maxFileBytes: Number.MAX_SAFE_INTEGER,
    maxFilesPerMessage: 8,
    maxMessageFileBytes: Number.MAX_SAFE_INTEGER,
  }
  validateFile(_input: SaveFileAttachment): Promise<void> {
    return Promise.resolve()
  }
  saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef> {
    return Promise.resolve({
      attachmentId: `sha256:${'a'.repeat(64)}`,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      ...input.name === undefined ? {} : { name: input.name },
    })
  }
  readFile(): Promise<StoredFileAttachment> {
    return Promise.reject(new Error('unused'))
  }
  validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.resolve()
  }
  saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return Promise.reject(new Error('unused'))
  }
  readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    return Promise.reject(new Error('unused'))
  }
}

class StubSpillStore extends SpillStore {
  readonly saved: SaveTextSpill[] = []
  async saveText(input: SaveTextSpill): Promise<SpillRef> {
    this.saved.push(input)
    return {
      locator: SpillLocator(`D:/tmp/session-abc/${input.suggestedName}`),
      bytes: Buffer.byteLength(input.content, 'utf8'),
      retrievalHint: 'Use read with offset/limit, or grep this path to search within it.',
    }
  }
}

function filePart(mediaType: string, data: string, name: string) {
  return { type: 'file' as const, mediaType, data: Buffer.from(data, 'utf8').toString('base64'), name }
}

function fileBlockOf(blocks: ContentBlock[]): Extract<ContentBlock, { type: 'file' }> {
  const block = blocks[0]
  if (block === undefined || block.type !== 'file') throw new Error('expected a file block')
  return block
}

describe('durablePromptContent large-file spill', () => {
  it('spills extracted text beyond the inline cap and points the model at the path', async () => {
    const ctx = new Context()
    const attachments = new StubAttachmentStore(ctx)
    const spill = new StubSpillStore(ctx)

    const big = 'x'.repeat(MAX_INLINE_FILE_CHARS + 1)
    const blocks = await durablePromptContent(ctx, 'session-s' as never, [filePart('text/plain', big, 'big.txt')])
    const file = fileBlockOf(blocks)
    expect(file.attachment.name).toBe('big.txt')
    expect(file.text).toContain('D:/tmp/session-abc/')
    expect(file.text).toContain('read')
    expect(file.text).not.toContain('xxxx')
    expect(spill.saved).toHaveLength(1)
    expect(spill.saved[0]?.content).toBe(big)
    expect(spill.saved[0]?.suggestedName).toBe('big.txt.txt')
  })

  it('keeps extracted text at or under the inline cap in the message', async () => {
    const ctx = new Context()
    const attachments = new StubAttachmentStore(ctx)
    const spill = new StubSpillStore(ctx)

    const small = 'hello attachment'
    const blocks = await durablePromptContent(ctx, 'session-s' as never, [filePart('text/plain', small, 'small.txt')])
    const file = fileBlockOf(blocks)
    expect(file.text).toBe(small)
    expect(spill.saved).toHaveLength(0)
  })

  it('falls back to inline text when no spill backend is mounted', async () => {
    const ctx = new Context()
    const attachments = new StubAttachmentStore(ctx)

    const big = 'y'.repeat(MAX_INLINE_FILE_CHARS + 1)
    const blocks = await durablePromptContent(ctx, 'session-s' as never, [filePart('text/plain', big, 'big.txt')])
    const file = fileBlockOf(blocks)
    expect(file.text).toBe(big)
  })
})
