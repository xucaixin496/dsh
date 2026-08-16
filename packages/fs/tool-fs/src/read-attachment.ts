/**
 * The model-facing `read_attachment` tool: reads a session-authorized file
 * attachment (uploaded by the user) by its durable attachment id and returns
 * the decoded text when the bytes are text-like, or metadata when the
 * attachment is opaque binary. Images keep using `read_image`.
 * @module @deepseek-ai/dsh-tool-fs/src/read-attachment
 */

import type { Context } from '@deepseek-ai/cordis'
import { extractFileText } from '@deepseek-ai/dsh-attachment'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'

/** The canonical outcome declared by the `read_attachment` output schema. */
export interface AttachmentReadValue {
  attachmentId: string
  mediaType: string
  bytes: number
  name?: string
  text?: string
}

function fileRefsInContent(content: unknown, match: (ref: FileAttachmentRef) => boolean): FileAttachmentRef | undefined {
  if (!Array.isArray(content)) return undefined
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as { type?: unknown; attachment?: unknown; content?: unknown }
    if (block.type === 'file' && typeof block.attachment === 'object' && block.attachment !== null) {
      const ref = block.attachment as FileAttachmentRef
      if (match(ref)) return ref
    }
    if (block.type === 'tool-result') {
      const nested = fileRefsInContent(block.content, match)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/**
 * Find the first session-authorized file reference matching one opaque id.
 * Authorization derives from the model-visible surface: an attachment the
 * current session does not show cannot be read.
 * @param session - the calling agent's session.
 * @param attachmentId - opaque attachment id.
 * @returns the matching durable reference, or undefined.
 */
function referencedFile(
  session: { deriveMessages(): Array<{ content: readonly unknown[] }> },
  attachmentId: string,
): FileAttachmentRef | undefined {
  for (const message of session.deriveMessages()) {
    const found = fileRefsInContent(message.content, ref => String(ref.attachmentId) === attachmentId)
    if (found !== undefined) return found
  }
  return undefined
}

/** Format the model-facing envelope for one attachment read. */
function formatAttachmentReadOutput(
  value: { attachmentId: string; mediaType: string; bytes: number; name?: string },
  text: string | undefined,
): string {
  const name = value.name ?? '(unnamed)'
  const head = `<attachment_id>${value.attachmentId}</attachment_id>
<name>${name}</name>
<type>${value.mediaType}</type>
<size>${value.bytes} bytes</size>`
  return text === undefined
    ? `${head}
<content>
This file is opaque binary; it cannot be inlined as text. Use format-appropriate tooling to inspect it.
</content>`
    : `${head}
<content>
${text}
</content>`
}

/**
 * Register the `read_attachment` tool into the given context. The composing
 * plugin owns the attachments gate: `src/index.ts` calls this inside
 * `ctx.inject(['attachments'], …)` so the tool exists only while a durable
 * store is mounted.
 * @param ctx - the registration scope; execution uses the optional
 *   `attachments` service plus the calling agent's session surface.
 */
export function applyReadAttachmentTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'read_attachment',
    description: 'Read a file the user attached to this conversation. Returns the decoded text when the file is text-like, otherwise the file metadata. Use the attachment id shown with the uploaded file.',
    parameters: {
      attachment_id: { type: 'string', required: true, description: 'Opaque attachment id from the conversation.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          attachmentId: { type: 'string', required: true },
          mediaType: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          name: { type: 'string' },
          text: { type: 'string' },
        },
      },
      render: (_args, value: AttachmentReadValue) => [{
        type: 'text',
        text: formatAttachmentReadOutput(value, value.text),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args: { attachment_id: string }, exec) {
      const id = String(args.attachment_id).trim()
      if (id === '') throw new Error('attachment_id must be a non-empty string')
      const attachments = ctx.get('attachments')
      if (attachments === undefined) throw new Error('cannot read attachments: no attachment service is mounted')
      const session = exec.agent?.session
      if (session === undefined) throw new Error('cannot read attachment: no session context')
      const ref = referencedFile(session, id)
      if (ref === undefined) {
        throw new Error(`attachment "${id}" is not referenced by this session or is an image; images are rendered directly when the model supports them`)
      }
      const stored = await attachments.readFile(ref, exec.signal)
      const text = extractFileText(stored.data, stored.ref.mediaType, stored.ref.name)
      return {
        attachmentId: String(ref.attachmentId),
        mediaType: ref.mediaType,
        bytes: ref.bytes,
        ...ref.name === undefined ? {} : { name: ref.name },
        ...text === undefined ? {} : { text },
      }
    },
    presentCall(args: { attachment_id: string }): GenericCallView {
      return {
        card: 'generic',
        title: `Read attachment ${args.attachment_id}`,
        kind: 'read',
      }
    },
  }))
}
