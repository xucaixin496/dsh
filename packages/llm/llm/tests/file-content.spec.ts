import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CallId } from '../src/brand.ts'
import { contentHasFile, fileBlockText } from '../src/content.ts'
import type { ContentBlock } from '../src/types.ts'

const FILE_BLOCK: ContentBlock = {
  type: 'file',
  attachment: {
    attachmentId: AttachmentId('sha256:' + 'a'.repeat(64)),
    mediaType: 'text/markdown',
    bytes: 11,
    name: 'notes.md',
  },
  text: 'some notes',
}

describe('file content helpers', () => {
  it('detects file blocks including nested tool results', () => {
    expect(contentHasFile([FILE_BLOCK])).toBe(true)
    expect(contentHasFile([{ type: 'tool-result', toolCallId: CallId('t1'), content: [FILE_BLOCK] }])).toBe(true)
    expect(contentHasFile([{ type: 'text', text: 'plain' }])).toBe(false)
    expect(contentHasFile([])).toBe(false)
  })

  it('renders metadata plus extracted text', () => {
    expect(fileBlockText(FILE_BLOCK)).toBe('[Attachment: notes.md (text/markdown, 11 bytes)]\nsome notes')
  })

  it('renders only the metadata header without a text projection', () => {
    const block: ContentBlock = {
      type: 'file',
      attachment: {
        attachmentId: AttachmentId('sha256:' + 'b'.repeat(64)),
        mediaType: 'application/zip',
        bytes: 9,
        name: 'bundle.zip',
      },
    }
    expect(fileBlockText(block)).toBe('[Attachment: bundle.zip (application/zip, 9 bytes)]')
  })

  it('renders an unnamed fallback and empty text for non-file blocks', () => {
    const block: ContentBlock = {
      type: 'file',
      attachment: {
        attachmentId: AttachmentId('sha256:' + 'c'.repeat(64)),
        mediaType: 'application/octet-stream',
        bytes: 0,
      },
    }
    expect(fileBlockText(block)).toBe('[Attachment: (unnamed) (application/octet-stream, 0 bytes)]')
    expect(fileBlockText({ type: 'text', text: 'x' })).toBe('')
  })
})
