/**
 * Offline OCR for scanned documents. PDF pages are rendered with
 * `@napi-rs/canvas` and recognized by `tesseract.js` with locally bundled
 * `eng`/`chi_sim` traineddata, so scanned PDFs work without network access.
 * @module @deepseek-ai/dsh-attachment/ocr
 */

import { fileURLToPath } from 'node:url'

/** Absolute directory holding the bundled tesseract traineddata. */
export function tessdataDir(): string {
  return fileURLToPath(new URL('../assets/tessdata/', import.meta.url))
}

/** Languages recognized together; the bundled set is English + Simplified Chinese. */
const OCR_LANGS = 'eng+chi_sim'

/** Render scale caps: ~1400px wide pages are crisp without exploding memory. */
const MAX_RENDER_WIDTH = 1400
const MAX_RENDER_SCALE = 2

type OcrWorker = {
  recognize(input: Uint8Array | Buffer): Promise<{ data: { text: string } }>
  terminate(): Promise<void>
}

let workerPromise: Promise<OcrWorker> | undefined

async function getOcrWorker(): Promise<OcrWorker> {
  if (workerPromise === undefined) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js')
      return createWorker(OCR_LANGS, 1, {
        langPath: tessdataDir(),
        gzip: false,
      })
    })()
  }
  return workerPromise
}

/**
 * Recognize text in one PNG image. The worker is created lazily once per
 * process and reused; a recognition failure rejects but leaves the worker
 * available for the next call.
 * @param png - complete PNG bytes.
 * @returns the recognized text (possibly empty for blank pages).
 */
export async function ocrImagePng(png: Uint8Array): Promise<string> {
  const worker = await getOcrWorker()
  const { data } = await worker.recognize(png)
  return data.text
}

/**
 * Render one PDF page to a PNG and OCR it.
 * @param page - a pdfjs page object exposing getViewport and render.
 * @returns the recognized page text.
 */
export async function ocrPdfPage(page: {
  getViewport(params: { scale: number }): { width: number; height: number }
  render(params: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> }
}): Promise<string> {
  const { createCanvas } = await import('@napi-rs/canvas')
  const viewport = page.getViewport({ scale: 1 })
  const scale = Math.min(MAX_RENDER_SCALE, MAX_RENDER_WIDTH / Math.max(viewport.width, 1))
  const scaled = page.getViewport({ scale })
  const canvas = createCanvas(scaled.width, scaled.height)
  const context = canvas.getContext('2d')
  await page.render({ canvasContext: context, viewport: scaled }).promise
  const png = new Uint8Array(canvas.toBuffer('image/png'))
  return ocrImagePng(png)
}
