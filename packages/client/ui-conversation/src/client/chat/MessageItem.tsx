// MessageItem: simple chat nodes — user and consumed-steering bubbles
// (right-aligned, with clock + copy IconActions; branch lives only under
// assistant answers), pending steering (copy only), context injection,
// compaction marker, retry disclosure, and unknown-surface JSON rows.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PromptContentPart } from '@deepseek-ai/dsh-client-connection/client'
import type {
  ModelRetryNode, TurnErrorNode, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { JsonBlock, MessageText, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { FileChip } from '@deepseek-ai/dsh-client-ui-attachment'
import { messageFileLabels } from '../image-labels.ts'
import type { ChatNodeOwnerProps, ChatNodeViewProps, ChatViewSlotProps } from '../contract/slots.ts'
import { ReferenceIcon } from '../reference/ReferenceIcon.tsx'
import { CompactionItem } from './CompactionItem.tsx'
import { ContextInjectionRow } from './ContextInjectionRow.tsx'
import { MessageIconActions } from './MessageIconActions.tsx'
import {
  IconCloseOutline16, IconLoadingOutline16, IconPaperclipOutline16, IconSendOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './MessageItem.module.css'

type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>
type UserFile = Extract<UserMessageNode['content'][number], { type: 'file' }>

function contentParts(content: readonly unknown[]): {
  text: string
  images: { attachment: UserImage['attachment'] }[]
  files: { attachment: UserFile['attachment'] }[]
  rest: unknown[]
} {
  const texts: string[] = []
  const images: { attachment: UserImage['attachment'] }[] = []
  const files: { attachment: UserFile['attachment'] }[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string; attachment?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) {
      images.push({ attachment: (b as UserImage).attachment })
    }
    else if (b.type === 'file' && b.attachment !== undefined) {
      files.push({ attachment: (b as UserFile).attachment })
    }
    else rest.push(block)
  }
  return { text: texts.join(''), images, files, rest }
}

function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000))
}

interface RetryCountdown {
  deadline: number
  seconds: number
}

function ModelRetryItem({ node, active, t }: {
  node: ModelRetryNode
  active: boolean
  t: ChatViewSlotProps['t']
}) {
  // Anchor the host-scheduled delay to this browser's first render of the
  // retry node. Host event time and Date.now() may belong to different clocks.
  const deadline = useMemo(() => Date.now() + node.delayMs, [node.delayMs, node.seq])
  const scheduledSeconds = retrySeconds(node.delayMs)
  const maximum = node.mode === 'normal' ? node.maxRetries : '∞'
  const [countdown, setCountdown] = useState<RetryCountdown>(() => ({
    deadline,
    seconds: retrySeconds(deadline - Date.now()),
  }))
  const remainingSeconds = countdown.deadline === deadline
    ? countdown.seconds
    : retrySeconds(deadline - Date.now())

  useEffect(() => {
    if (!active) return
    const updateCountdown = (): number => {
      const next = retrySeconds(deadline - Date.now())
      setCountdown(current => (
        current.deadline === deadline && current.seconds === next
          ? current
          : { deadline, seconds: next }
      ))
      return next
    }
    if (updateCountdown() === 1) return
    const timer = window.setInterval(() => {
      if (updateCountdown() === 1) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [active, deadline])

  const label = active
    ? t('message.retry.active')
    : node.retryState === 'cancelled'
      ? t('message.retry.cancelled')
      : node.retryState === 'started'
        ? t('message.retry.started')
        : t('message.retry.scheduled')
  const seconds = active ? remainingSeconds : scheduledSeconds

  return (
    <details className={css.retryRow} data-active={active || undefined}>
      <summary className={css.retrySummary}>
        <span className={css.retryText} role="status">
          {t('message.retry.status', { label, retry: node.retry, maximum, seconds })}
        </span>
      </summary>
      <div className={css.retryDetails}>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.delay')}</span>
          {Math.round(node.delayMs)}ms
        </div>
        <div>
          <span className={css.retryDetailLabel}>{t('message.retry.failure')}</span>
          {node.failure.message}
        </div>
      </div>
    </details>
  )
}

/** Persistent, turn-positioned feedback for a terminal failure. */
function TurnErrorItem({ node, t }: {
  node: TurnErrorNode
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="error" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.turnErrorTitle}>{t('message.turnError')}</span>
        <span className={css.turnErrorMessage}>{node.message}</span>
      </div>
      {node.code !== undefined && <code className={css.turnErrorCode}>{node.code}</code>}
    </div>
  )
}

/** Persistent, turn-positioned notice for a turn ended at the output-token cap. */
function TurnMaxTokensItem({ t }: {
  t: ChatViewSlotProps['t']
}) {
  return (
    <div className={css.turnErrorRow} role="status">
      <StateDot state="warning" className={css.turnErrorDot} />
      <div className={css.turnErrorCopy}>
        <span className={css.maxTokensTitle}>{t('message.maxTokens')}</span>
        <span className={css.turnErrorMessage}>{t('message.maxTokens.hint')}</span>
      </div>
    </div>
  )
}

/**
 * Display projection of reference forms in a user bubble (free geometry — no
 * textarea alignment constraint here); everything else stays plain text. The
 * logged model text remains the single truth; this is presentation only.
 * Plain-text `/name` / `@name` word-boundary tokens decorate (the sent text
 * IS the reference — the bubble uses the same plainest token
 * scan as the composer, minus the lexicon: sent tokens were validated at
 * compose time, so shape alone decorates).
 */
function projectUserText(text: string, sessionLabels: readonly string[]): ReactNode {
  const ranges: { start: number; end: number; label: string; kind: 'session' | 'plain' }[] = []
  for (const rawLabel of [...new Set(sessionLabels)].sort((a, b) => b.length - a.length)) {
    const label = `@${rawLabel}`
    let start = text.indexOf(label)
    while (start >= 0) {
      ranges.push({ start, end: start + label.length, label, kind: 'session' })
      start = text.indexOf(label, start + label.length)
    }
  }
  const re = /(^|\s)(\/[\w-]+|@"[^"\n]+"|@[^\s]+)/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tokenStart = m.index + (m[1]?.length ?? 0)
    const rawLabel = m[2] ?? ''
    const label = rawLabel.startsWith('@"')
      ? rawLabel
      : rawLabel.replace(/[.,;:!?，。；：！？]+$/gu, '')
    if (label.length <= 1) continue
    ranges.push({ start: tokenStart, end: tokenStart + label.length, label, kind: 'plain' })
  }
  ranges.sort((a, b) => a.start - b.start
    || (a.kind === b.kind ? b.end - a.end : a.kind === 'session' ? -1 : 1))
  const parts: ReactNode[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start < cursor) continue
    const { start: tokenStart, end, label, kind } = range
    if (tokenStart > cursor) parts.push(<MessageText key={cursor} text={text.slice(cursor, tokenStart)} />)
    const referenceKind = kind === 'session'
      ? 'session'
      : label.startsWith('@')
        ? label.endsWith('/') ? 'folder' : 'file'
        : undefined
    const displayLabel = referenceKind === undefined
      ? label
      : referenceKind === 'session'
        ? label.slice(1)
        : label.slice(1).replace(/^"|"$/gu, '').split(/[\\/]/u).filter(Boolean).at(-1) ?? label.slice(1)
    parts.push(
      <span
        key={tokenStart}
        className={css.refChip}
        data-ref-chip={referenceKind ?? 'skill'}
        title={label}
      >
        {referenceKind !== undefined && (
          <ReferenceIcon kind={referenceKind} size={16} className={css.refIcon} />
        )}
        {displayLabel}
      </span>,
    )
    cursor = end
  }
  if (parts.length === 0) return <MessageText text={text} />
  if (cursor < text.length) parts.push(<MessageText key={cursor} text={text.slice(cursor)} />)
  return <>{parts}</>
}

/** Download one durable file attachment through the session-authorized loader. */
function downloadAttachment(
  fileLoader: (attachment: UserFile['attachment']) => Promise<{ data: Uint8Array; name?: string; mediaType: string }>,
  attachment: UserFile['attachment'],
): void {
  void fileLoader(attachment)
    .then((loaded) => {
      const buffer = new ArrayBuffer(loaded.data.byteLength)
      new Uint8Array(buffer).set(loaded.data)
      const blob = new Blob([buffer], { type: loaded.mediaType })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = loaded.name ?? attachment.name ?? 'attachment'
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    })
    .catch((error: unknown) => {
      // A failed download is reported by the owner surface's error path;
      // the chip stays interactive for a retry.
      console.error('download file attachment failed', error)
    })
}

/** Right-aligned bubble shared by user and steering rows. */
function UserStyleBubble({
  content, fileLoader, renderMessageImages, actions, pending = false,
  editing = false, editValue = '', onEditChange, onCancelEdit, onSendEdit,
  sendingEdit = false, editAttachments, referenceLabels = [], t,
}: {
  content: readonly unknown[]
  fileLoader: (attachment: UserFile['attachment']) => Promise<{ data: Uint8Array; name?: string; mediaType: string }>
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Optional IconActions (or similar) below the bubble; receives the joined text. */
  actions?: ((text: string) => ReactNode) | undefined
  /** Whether this is the Host-authoritative pre-admission steering projection. */
  pending?: boolean
  /** In-bubble edit mode: the text becomes a textarea plus a send/cancel footer. */
  editing?: boolean
  /** Current edit draft value while `editing`. */
  editValue?: string
  onEditChange?: (value: string) => void
  onCancelEdit?: () => void
  onSendEdit?: () => void
  /** An edit resend is in flight; the footer's send control disables while true. */
  sendingEdit?: boolean
  /** In-bubble attachment management while `editing`: removable originals, new uploads, add handler. */
  editAttachments?: {
    removable: { id: string; name: string; bytes: number; mediaType: string; onDownload: () => void }[]
    added: { name: string; bytes: number; mediaType: string; onDownload: () => void }[]
    onRemove: (id: string) => void
    onRemoveAdded: (index: number) => void
    onAddFiles: (files: FileList | null) => void
    addLabel: string
  } | undefined
  /** Exact session mention labels associated by the adjacent recall node. */
  referenceLabels?: readonly string[]
  t: ChatViewSlotProps['t']
}): ReactNode {
  const { text, images, files, rest } = contentParts(content)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const truncated = (total: number): string => t('json.truncated', { total })
  const showBubble = text !== '' || rest.length > 0
  return (
    <div className={css.userRow} data-pending-steering={pending || undefined} data-time-hover-root>
      <div className={css.userStack}>
        {!editing && renderMessageImages({ images, align: 'end' })}
        {!editing && files.length > 0 && (
          <div className={css.fileList}>
            {files.map((file, index) => (
              <FileChip
                key={String(file.attachment.attachmentId) + index}
                value={{
                  name: file.attachment.name ?? t('file.unnamed'),
                  bytes: file.attachment.bytes,
                  mediaType: file.attachment.mediaType,
                }}
                labels={messageFileLabels(t)}
                onDownload={() => { downloadAttachment(fileLoader, file.attachment) }}
              />
            ))}
          </div>
        )}
        {editing && (
          <div className={`${css.bubble} ${css.bubbleEditing}`}>
            <textarea
              className={css.editInput}
              value={editValue}
              onChange={event => onEditChange?.(event.target.value)}
              placeholder={t('message.edit.placeholder')}
              aria-label={t('message.edit.placeholder')}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  onSendEdit?.()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  onCancelEdit?.()
                }
              }}
            />
            {editAttachments !== undefined
              && (editAttachments.removable.length > 0 || editAttachments.added.length > 0) && (
              <div className={css.editAttachments}>
                {editAttachments.removable.map(attachment => (
                  <span key={attachment.id} className={css.editAttachmentChip}>
                    <FileChip
                      value={{
                        name: attachment.name || t('file.unnamed'),
                        bytes: attachment.bytes,
                        mediaType: attachment.mediaType,
                      }}
                      labels={messageFileLabels(t)}
                      onDownload={attachment.onDownload}
                    />
                    <button
                      type="button"
                      className={css.editAttachmentRemove}
                      aria-label={t('message.edit.removeAttachment', { name: attachment.name })}
                      onClick={() => editAttachments.onRemove(attachment.id)}
                    >
                      <IconCloseOutline16 />
                    </button>
                  </span>
                ))}
                {editAttachments.added.map((attachment, index) => (
                  <span key={`added-${index}`} className={css.editAttachmentChip}>
                    <FileChip
                      value={{
                        name: attachment.name || t('file.unnamed'),
                        bytes: attachment.bytes,
                        mediaType: attachment.mediaType,
                      }}
                      labels={messageFileLabels(t)}
                      onDownload={attachment.onDownload}
                    />
                    <button
                      type="button"
                      className={css.editAttachmentRemove}
                      aria-label={t('message.edit.removeAttachment', { name: attachment.name })}
                      onClick={() => editAttachments.onRemoveAdded(index)}
                    >
                      <IconCloseOutline16 />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className={css.editFooter}>
              <button
                type="button"
                className={css.editAttach}
                onClick={() => fileInputRef.current?.click()}
              >
                <IconPaperclipOutline16 />
                {editAttachments?.addLabel ?? t('message.edit.addAttachment')}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className={css.visuallyHidden}
                onChange={(event) => {
                  editAttachments?.onAddFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              <span className={css.editShortcut}>{t('message.edit.hint')}</span>
              <span className={css.editSpacer} />
              <button
                type="button"
                className={css.editCancel}
                onClick={onCancelEdit}
              >
                <IconCloseOutline16 />
                {t('message.edit.cancel')}
              </button>
              <button
                type="button"
                className={css.editSend}
                aria-label={t('message.edit.send')}
                disabled={(
                  editValue.trim() === ''
                  && (editAttachments?.removable.length ?? 0) === 0
                  && (editAttachments?.added.length ?? 0) === 0
                ) || sendingEdit}
                onClick={onSendEdit}
              >
                {sendingEdit ? <IconLoadingOutline16 /> : <IconSendOutline16 />}
              </button>
            </div>
          </div>
        )}
        {!editing && showBubble && <div className={css.bubble}>
          {projectUserText(text, referenceLabels)}
          {rest.map((block, i) => <JsonBlock key={i} label={t('message.extraBlock')} payload={block} truncatedLabel={truncated} />)}
        </div>}
        {!editing && referenceLabels.length > 0 && (
          <div className={css.referenceSummary}>
            {t('message.referenceSummary', { labels: referenceLabels.join(t('message.referenceSeparator')) })}
          </div>
        )}
      </div>
      {!editing && actions?.(text)}
    </div>
  )
}

/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 * @param props - Pending message content and conversation translator.
 * @returns the pending steering bubble.
 */
export function PendingSteeringBubble({ content, loadFile, renderMessageImages, t }: {
  content: readonly unknown[]
  loadFile: (attachment: UserFile['attachment']) => Promise<{ data: Uint8Array; name?: string; mediaType: string }>
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  t: ChatViewSlotProps['t']
}): ReactNode {
  return (
    <UserStyleBubble
      content={content}
      fileLoader={loadFile}
      renderMessageImages={renderMessageImages}
      pending
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          clock="start"
          className={css.actions}
          t={t}
        />
      )}
    />
  )
}

/** User and admitted-steering keyed Chat renderer. */
export const UserMessageNodeView = memo(function UserMessageNodeView({
  node, loadFile, resendAt, renderMessageImages, t,
}: ChatNodeViewProps<'user' | 'steering'>) {
  const data = node.data
  const { text, images, files } = contentParts(data.content)
  const hasAttachments = images.length > 0 || files.length > 0
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [addedParts, setAddedParts] = useState<PromptContentPart[]>([])
  const startEdit = useCallback(() => {
    setDraft(text)
    setRemovedIds(new Set())
    setAddedParts([])
    setEditing(true)
  }, [text])
  const cancelEdit = useCallback(() => {
    setEditing(false)
    setDraft('')
    setRemovedIds(new Set())
    setAddedParts([])
  }, [])
  const submitEdit = useCallback(async () => {
    const next = draft.trim()
    if (sending) return
    // Nothing would remain to send: empty text, no kept originals, no new uploads.
    const originalAttachmentCount = files.length + images.length
    if (next === '' && addedParts.length === 0 && removedIds.size >= originalAttachmentCount) return
    setSending(true)
    try {
      const accepted = await resendAt(node.data.seq, {
        text: next,
        ...(removedIds.size > 0 ? { removeAttachmentIds: [...removedIds] } : {}),
        ...(addedParts.length > 0 ? { additions: addedParts } : {}),
      })
      if (accepted) setEditing(false)
    } finally {
      setSending(false)
    }
  }, [draft, sending, removedIds, addedParts, files.length, images.length, resendAt, node.data.seq])
  const resend = useCallback(() => {
    if (sending || (text.trim() === '' && !hasAttachments)) return
    setSending(true)
    // Plain regenerate re-runs the ORIGINAL message content (attachments
    // included); only the edit path sends replacement text.
    void resendAt(node.data.seq).finally(() => setSending(false))
  }, [sending, text, hasAttachments, resendAt, node.data.seq])
  const toggleRemove = useCallback((id: string) => {
    setRemovedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const removeAdded = useCallback((index: number) => {
    setAddedParts(previous => previous.filter((_, at) => at !== index))
  }, [])
  const addFiles = useCallback((fileList: FileList | null) => {
    const filesToRead = fileList === null ? [] : Array.from(fileList)
    for (const file of filesToRead) {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : ''
        const comma = dataUrl.indexOf(',')
        const data = comma >= 0 ? dataUrl.slice(comma + 1) : ''
        const mediaType = file.type || 'application/octet-stream'
        const name = file.name === '' ? undefined : file.name
        const part: PromptContentPart = mediaType === 'image/png'
          || mediaType === 'image/jpeg' || mediaType === 'image/webp' || mediaType === 'image/gif'
          ? { type: 'image', mediaType: mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data, ...(name === undefined ? {} : { name }) }
          : { type: 'file', mediaType, data, ...(name === undefined ? {} : { name }) }
        setAddedParts(previous => [...previous, part])
      }
      reader.readAsDataURL(file)
    }
  }, [])
  const removable = useMemo(() => [
    ...files.map(file => ({
      id: String(file.attachment.attachmentId),
      name: file.attachment.name ?? t('file.unnamed'),
      bytes: file.attachment.bytes,
      mediaType: file.attachment.mediaType,
      onDownload: () => { downloadAttachment(loadFile, file.attachment) },
    })),
    ...images.map(image => ({
      id: String(image.attachment.attachmentId),
      name: image.attachment.name ?? t('image.label'),
      bytes: image.attachment.bytes,
      mediaType: image.attachment.mediaType,
      onDownload: () => {},
    })),
  ].filter(attachment => !removedIds.has(attachment.id)), [files, images, removedIds, loadFile, t])
  const added = useMemo(() => addedParts
    .filter((part): part is Extract<PromptContentPart, { type: 'image' | 'file' }> => part.type !== 'text')
    .map(part => ({
      name: part.name ?? t('file.unnamed'),
      bytes: Math.floor((part.data.length * 3) / 4),
      mediaType: part.mediaType,
      onDownload: () => {},
    })), [addedParts, t])
  const canEdit = text.trim() !== '' || hasAttachments
  return (
    <UserStyleBubble
      content={data.content}
      fileLoader={loadFile}
      renderMessageImages={renderMessageImages}
      {...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }}
      t={t}
      editing={editing}
      editValue={draft}
      onEditChange={setDraft}
      onCancelEdit={cancelEdit}
      onSendEdit={submitEdit}
      sendingEdit={sending}
      editAttachments={editing ? {
        removable,
        added,
        onRemove: toggleRemove,
        onRemoveAdded: removeAdded,
        onAddFiles: addFiles,
        addLabel: t('message.edit.addAttachment'),
      } : undefined}
      actions={!editing ? bubbleText => (
        <MessageIconActions
          text={bubbleText}
          time={data.time}
          clock="start"
          className={css.actions}
          t={t}
          onEdit={canEdit ? startEdit : undefined}
          onResend={canEdit ? resend : undefined}
          resendBusy={sending}
        />
      ) : undefined}
    />
  )
})

/** Injected-context keyed Chat renderer. */
export const ContextMessageNodeView = memo(function ContextMessageNodeView({ node, t }: ChatNodeViewProps<'context'>) {
  const data = node.data
  return (
    <ContextInjectionRow
      content={data.content}
      source={data.source}
      provenance={data.provenance}
      form={data.form}
      t={t}
    />
  )
})

/** Automatic compaction keyed Chat renderer. */
export const CompactionNodeView = memo(function CompactionNodeView({ node, t }: ChatNodeViewProps<'compaction'>) {
  return <CompactionItem node={node.data} t={t} />
})

/** Correlated retry-chain keyed Chat renderer. */
export const RetryNodeView = memo(function RetryNodeView({ node, t }: ChatNodeViewProps<'model-retry'>) {
  const data = node.data
  return <ModelRetryItem node={data.current} active={data.current.retryState === 'scheduled'} t={t} />
})

/** Terminal turn-error keyed Chat renderer. */
export const TurnErrorNodeView = memo(function TurnErrorNodeView({ node, t }: ChatNodeViewProps<'turn-error'>) {
  return <TurnErrorItem node={node.data} t={t} />
})

/** Max-tokens turn-end notice keyed Chat renderer. */
export const TurnMaxTokensNodeView = memo(function TurnMaxTokensNodeView({ t }: ChatNodeViewProps<'turn-max-tokens'>) {
  return <TurnMaxTokensItem t={t} />
})

/** Explicit unknown-surface keyed Chat renderer. */
export const UnknownNodeView = memo(function UnknownNodeView({ node, t }: ChatNodeViewProps<'unknown'>) {
  const data = node.data
  return (
    <div className={css.contextRow}>
      <JsonBlock
        label={t('message.unknownSurface', { type: data.type })}
        payload={data.data}
        truncatedLabel={total => t('json.truncated', { total })}
      />
    </div>
  )
})
