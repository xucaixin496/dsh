/** History file-attachment chip: name/size badge with a download action. */

import { IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './FileChip.module.css'

/** One rendered file attachment in chat history. */
export interface FileChipValue {
  /** Display name (owner applies its fallback). */
  name: string
  /** Exact byte length for the size label. */
  bytes: number
  /** Media type shown as a short badge. */
  mediaType: string
}

/** Chip-level strings the owner resolves from its locale namespace. */
export interface FileChipLabels {
  /** Accessible label of the download button. */
  download: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function badgeText(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot < 0 ? '' : name.slice(dot + 1).toUpperCase().slice(0, 4)
  return ext === '' ? 'FILE' : ext
}

/**
 * Compact attachment chip with the extension badge, name, size, and a
 * download button. The owner supplies the download action and locale labels.
 * @param props - the file value, labels, and download handler.
 */
export function FileChip({ value, labels, onDownload }: {
  value: FileChipValue
  labels: FileChipLabels
  onDownload: () => void
}) {
  return (
    <div className={css.chip} title={`${value.name} · ${value.mediaType}`}>
      <span className={css.badge}>{badgeText(value.name)}</span>
      <span className={css.meta}>
        <span className={css.name}>{value.name}</span>
        <span className={css.size}>{formatBytes(value.bytes)}</span>
      </span>
      <button
        type="button"
        className={css.download}
        aria-label={labels.download}
        title={labels.download}
        onClick={(event) => {
          event.stopPropagation()
          onDownload()
        }}
      >
        <IconDownloadOutline16 size={14} />
      </button>
    </div>
  )
}
