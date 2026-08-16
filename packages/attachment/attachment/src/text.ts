/** Server-side text projection for generic file attachments. @module @deepseek-ai/dsh-attachment/text */

/**
 * Media-type families that are plain text and therefore safe to project into
 * model context byte-for-byte (after decoding).
 */
const TEXT_FAMILIES = ['text/']

/** Exact non-`text/*` media types whose bytes are plain text. */
const TEXT_MEDIA_TYPES = new Set([
  'application/json',
  'application/x-ndjson',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/x-toml',
  'application/csv',
  'application/x-csv',
  'application/sql',
  'application/x-sh',
  'application/x-shellscript',
  'application/x-python',
])

/** Extensions treated as plain text regardless of the declared media type. */
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'mdown',
  'json', 'jsonl', 'ndjson', 'geojson',
  'yaml', 'yml',
  'csv', 'tsv',
  'xml', 'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte',
  'py', 'pyw', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'psd1', 'psm1',
  'log', 'ini', 'conf', 'cfg', 'env', 'properties', 'toml', 'sql',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hxx', 'java', 'kt', 'kts', 'scala',
  'go', 'rs', 'rb', 'php', 'lua', 'swift', 'dart', 'r', 'pl', 'pm', 'ex', 'exs',
  'ipynb', 'gradle', 'dockerfile', 'makefile', 'gitignore', 'editorconfig',
])

/**
 * Decide whether a generic attachment should be decoded and projected as
 * text. Binary document formats (PDF, DOCX, XLSX, archives) are excluded so
 * their raw bytes never masquerade as text; the model reads those through
 * tools instead.
 * @param mediaType - declared media type.
 * @param name - optional display name used for extension fallback.
 * @returns whether a text projection should be attempted.
 */
export function shouldExtractText(mediaType: string, name?: string): boolean {
  const type = mediaType.trim().toLowerCase()
  if (TEXT_FAMILIES.some(family => type.startsWith(family))) return true
  if (TEXT_MEDIA_TYPES.has(type)) return true
  if (name === undefined) return false
  const leaf = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const dot = leaf.lastIndexOf('.')
  if (dot < 0) return false
  return TEXT_EXTENSIONS.has(leaf.slice(dot + 1).toLowerCase())
}

/** Cap on projected characters; longer text is truncated with a marker. */
const MAX_PROJECTED_CHARS = 1_000_000

function decodeUtf16(data: Uint8Array): string | undefined {
  try {
    if (data.byteLength >= 2 && data[0] === 0xff && data[1] === 0xfe) {
      return new TextDecoder('utf-16le', { fatal: true }).decode(data.subarray(2))
    }
    if (data.byteLength >= 2 && data[0] === 0xfe && data[1] === 0xff) {
      return new TextDecoder('utf-16be', { fatal: true }).decode(data.subarray(2))
    }
  } catch {
    // fall through: not UTF-16
  }
  return undefined
}

function decodeGb18030(data: Uint8Array): string | undefined {
  try {
    return new TextDecoder('gb18030', { fatal: true }).decode(data)
  } catch {
    return undefined
  }
}

/**
 * Decode attachment bytes as plain text when the media type or extension
 * says they are text-like. Decoding order: UTF-8 (strict), UTF-16 (BOM),
 * GB18030 (strict). Non-text types and undecodable bytes return undefined.
 * @param data - complete attachment bytes.
 * @param mediaType - declared media type.
 * @param name - optional display name.
 * @returns the decoded projection (possibly truncated), or undefined.
 */
export function extractFileText(data: Uint8Array, mediaType: string, name?: string): string | undefined {
  if (!shouldExtractText(mediaType, name)) return undefined
  let text: string | undefined
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    text = decodeUtf16(data) ?? decodeGb18030(data)
  }
  if (text === undefined) return undefined
  if (text.length > MAX_PROJECTED_CHARS) {
    return `${text.slice(0, MAX_PROJECTED_CHARS)}\n…[truncated: ${text.length} characters total]`
  }
  return text
}
