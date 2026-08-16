/**
 * Server-side text projection for generic file attachments. Text-like bytes
 * are decoded directly; PDF/DOCX/XLSX/PPTX documents are parsed into plain
 * text the way ChatGPT/Claude web uploads are, so the model reads the file
 * contents from the very first turn without extra tool calls.
 * @module @deepseek-ai/dsh-attachment/text
 */

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

/** Document formats parsed into text with dedicated extractors. */
const DOCUMENT_MEDIA_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

const DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'pptx'])

/**
 * Decide whether a generic attachment can be projected as text: plain-text
 * families/extensions plus the document formats with dedicated extractors.
 * Opaque binaries (archives, executables, media) are excluded.
 * @param mediaType - declared media type.
 * @param name - optional display name used for extension fallback.
 * @returns whether a text projection should be attempted.
 */
export function shouldExtractText(mediaType: string, name?: string): boolean {
  const type = mediaType.trim().toLowerCase()
  if (TEXT_FAMILIES.some(family => type.startsWith(family))) return true
  if (TEXT_MEDIA_TYPES.has(type)) return true
  if (DOCUMENT_MEDIA_TYPES.has(type)) return true
  if (name === undefined) return false
  const leaf = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const dot = leaf.lastIndexOf('.')
  if (dot < 0) return false
  const ext = leaf.slice(dot + 1).toLowerCase()
  return TEXT_EXTENSIONS.has(ext) || DOCUMENT_EXTENSIONS.has(ext)
}

/**
 * Cap on projected characters. The projection rides directly in the model
 * request, so the cap is far below the byte cap: roughly 40k tokens of text
 * keeps admission fast and the prompt usable.
 */
const MAX_PROJECTED_CHARS = 200_000
/** PDF pages parsed per attachment (deeper files truncate with a marker). */
const MAX_PDF_PAGES = 200
/** XLSX rows parsed per attachment. */
const MAX_XLSX_ROWS = 2_000
/** PPTX slides parsed per attachment. */
const MAX_PPTX_SLIDES = 100

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

async function extractPdfText(data: Uint8Array): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  })
  const doc = await loadingTask.promise
  try {
    const parts: string[] = []
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES)
    for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items
        .map(item => 'str' in item ? item.str : '')
        .join(' ')
      parts.push(text.trim())
      page.cleanup()
    }
    if (doc.numPages > MAX_PDF_PAGES) {
      parts.push(`…[truncated: ${doc.numPages} pages total]`)
    }
    return parts.join('\n')
  } finally {
    await loadingTask.destroy()
  }
}

async function extractDocxText(data: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({
    buffer: Buffer.from(data.buffer, data.byteOffset, data.byteLength),
  })
  return result.value
}

async function extractXlsxText(data: Uint8Array): Promise<string> {
  const { readSheet } = await import('read-excel-file/node')
  const rows = await readSheet(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
  const lines: string[] = []
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, MAX_XLSX_ROWS); rowIndex++) {
    const row = rows[rowIndex]
    lines.push(row.map(cell => (cell === null || cell === undefined ? '' : String(cell))).join('\t'))
  }
  if (rows.length > MAX_XLSX_ROWS) {
    lines.push(`…[truncated: ${rows.length} rows total]`)
  }
  return lines.join('\n')
}

async function extractPptxText(data: Uint8Array): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
  const slideNames = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      return na - nb
    })
  const parts: string[] = []
  for (const name of slideNames.slice(0, MAX_PPTX_SLIDES)) {
    const entry = zip.files[name]
    if (entry === undefined) continue
    const xml = await entry.async('text')
    const texts = Array.from(xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g))
      .map(match => match[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'"))
      .map(text => text.trim())
      .filter(text => text !== '')
    parts.push(texts.join(' '))
  }
  if (slideNames.length > MAX_PPTX_SLIDES) {
    parts.push(`…[truncated: ${slideNames.length} slides total]`)
  }
  return parts.join('\n')
}

/** Cap one extracted document at the shared projection bound. */
function truncateProjection(text: string): string {
  if (text.length <= MAX_PROJECTED_CHARS) return text
  return `${text.slice(0, MAX_PROJECTED_CHARS)}\n…[truncated: ${text.length} characters total]`
}

/**
 * Project attachment bytes as plain text: decode text-like bytes (UTF-8
 * strict, UTF-16 BOM, GB18030 strict) or parse PDF/DOCX/XLSX/PPTX documents.
 * Non-projectable types and undecodable bytes return undefined.
 * @param data - complete attachment bytes.
 * @param mediaType - declared media type.
 * @param name - optional display name.
 * @returns the decoded projection (possibly truncated), or undefined.
 */
export async function extractFileText(data: Uint8Array, mediaType: string, name?: string): Promise<string | undefined> {
  if (!shouldExtractText(mediaType, name)) return undefined
  const type = mediaType.trim().toLowerCase()
  if (type === 'application/pdf') return truncateProjection(await extractPdfText(data))
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return truncateProjection(await extractDocxText(data))
  }
  if (type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return truncateProjection(await extractXlsxText(data))
  }
  if (type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return truncateProjection(await extractPptxText(data))
  }
  let text: string | undefined
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    text = decodeUtf16(data) ?? decodeGb18030(data)
  }
  return text === undefined ? undefined : truncateProjection(text)
}
