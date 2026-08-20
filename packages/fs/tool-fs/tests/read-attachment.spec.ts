/**
 * The `read_attachment` tool over the REAL local attachment store:
 * session-authorized lookup, text projection for text-like bytes, metadata
 * fallback for opaque binary, and refusal for unknown ids.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import * as ToolFs from '../src/index.ts'

let dir = ''
let home = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-read-attachment-dir-'))
  home = await mkdtemp(join(tmpdir(), 'dsh-read-attachment-home-'))
  await mkdir(join(dir, 'nested'), { recursive: true })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(LocalAttachmentStore, { dshHome: home })
  await ctx.plugin(ToolFs)
  return ctx
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown, agent: object) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`att-call-${++callCounter}`),
    name,
    arguments: args,
    agent: agent as never,
  })
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

describe('read_attachment', () => {
  it('returns the decoded text for a text-like attachment', async () => {
    const ctx = await setup()
    const store = ctx.get('attachments')
    if (store === undefined) throw new Error('expected attachment store')
    const ref = await store.saveFile({
      data: Uint8Array.from(Buffer.from('hello from the attached file')),
      mediaType: 'text/plain',
      name: 'note.txt',
    })
    const agent = {
      session: {
        deriveMessages: () => [{ content: [{ type: 'file', attachment: ref }] }],
      },
    }
    const result = await call(ctx, 'read_attachment', { attachment_id: String(ref.attachmentId) }, agent)
    expect(result.isError).toBe(false)
    const text = textOf(result)
    expect(text).toContain('note.txt')
    expect(text).toContain('hello from the attached file')
  })

  it('returns metadata only for opaque binary attachments', async () => {
    const ctx = await setup()
    const store = ctx.get('attachments')
    if (store === undefined) throw new Error('expected attachment store')
    const ref = await store.saveFile({
      data: Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 1, 2, 3),
      mediaType: 'application/zip',
      name: 'bundle.zip',
    })
    const agent = {
      session: {
        deriveMessages: () => [{ content: [{ type: 'file', attachment: ref }] }],
      },
    }
    const result = await call(ctx, 'read_attachment', { attachment_id: String(ref.attachmentId) }, agent)
    expect(result.isError).toBe(false)
    const text = textOf(result)
    expect(text).toContain('bundle.zip')
    expect(text).toContain('opaque binary')
  })

  it('refuses an id not referenced by the session', async () => {
    const ctx = await setup()
    const agent = {
      session: {
        deriveMessages: () => [{ content: [{ type: 'text', text: 'no attachments here' }] }],
      },
    }
    const result = await call(ctx, 'read_attachment', { attachment_id: 'sha256:' + 'a'.repeat(64) }, agent)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('not referenced by this session')
  })
})
