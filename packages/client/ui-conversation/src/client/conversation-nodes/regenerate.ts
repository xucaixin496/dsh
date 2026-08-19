import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationNodeDefinition, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isReplacementSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import { chatNode, coordinate } from './common.ts'

/**
 * A user-initiated surface replacement (regenerate/rewrite): the anchored
 * `user/message` re-runs in place, shadowing its own turn and everything
 * after it on the model surface. Rendered exactly like an ordinary user
 * bubble; the shadowed seqs ride the node so the chat builder hides the
 * rolled-back turns.
 */
export const regenerateDefinition: ConversationNodeDefinition<UserMessageNode> = {
  kind: 'regenerate',
  target: 'chat',
  match: event => event.type === 'user/message'
    && isReplacementSurfaceEvent(event)
    && event.data.source.kind === 'user'
    ? { id: String(event.data.id), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'user/message') {
      throw new Error('regenerate start requires user/message')
    }
    const event = match.event
    const raw = event as typeof event & { sourceEventSeqs?: unknown }
    const shadowedSeqs = Array.isArray(raw.sourceEventSeqs)
      ? raw.sourceEventSeqs.filter((seq): seq is number => coordinate(seq) !== undefined)
      : []
    return {
      kind: 'user',
      seq: event.seq,
      time: event.time,
      content: event.data.content,
      source: event.data.source,
      ...(shadowedSeqs.length > 0 ? { shadowedSeqs } : {}),
    }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return chatNode(context, 'user', context.state.seq, context.state)
  },
}

/**
 * Register the regenerate/rewrite business contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerRegenerateConversationNode(ctx: Context): void {
  ctx.conversationEvents.register(regenerateDefinition)
}
