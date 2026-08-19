/** Content-block structure helpers. @module @deepseek-ai/dsh-llm/content */

import type { ContentBlock } from './types.ts'

/**
 * True when typed model content contains an image block, walking nested
 * tool-result content. This is the one recursive image walk shared by every
 * image policy (capability gating, text-only serialization, compaction
 * survey), so a consumer cannot silently diverge on nesting depth.
 * @param content - typed model content blocks.
 * @returns whether any nested block is an image.
 */
export function contentHasImage(content: readonly ContentBlock[]): boolean {
  return content.some(block => block.type === 'image'
    || (block.type === 'tool-result' && contentHasImage(block.content)))
}

/**
 * True when typed model content contains a file block, walking nested
 * tool-result content. Mirrors {@link contentHasImage} so consumers can gate
 * binary content uniformly without their own recursive walk.
 * @param content - typed model content blocks.
 * @returns whether any nested block is a file.
 */
export function contentHasFile(content: readonly ContentBlock[]): boolean {
  return content.some(block => block.type === 'file'
    || (block.type === 'tool-result' && contentHasFile(block.content)))
}

/**
 * Render one file block's model-facing text projection. The metadata header
 * always survives — including the opaque attachment id, which is what the
 * `read_attachment` tool resolves — and the optional server-side extracted
 * text follows it when present. Text-only adapters call this so a file
 * attachment is never silently erased from the wire conversation.
 * @param block - the file content block.
 * @returns the rendered text; empty for non-file blocks.
 */
export function fileBlockText(block: ContentBlock): string {
  if (block.type !== 'file') return ''
  const name = block.attachment.name ?? '(unnamed)'
  const header = `[Attachment: ${name} (${block.attachment.mediaType}, ${block.attachment.bytes} bytes, id: ${block.attachment.attachmentId})]`
  return block.text === undefined || block.text === '' ? header : `${header}\n${block.text}`
}
