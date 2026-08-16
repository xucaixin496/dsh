import { describe, expect, it } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { ocrImagePng, tessdataDir } from '../src/ocr.ts'

describe('offline OCR', () => {
  it('resolves the bundled traineddata directory', () => {
    expect(tessdataDir()).toContain('tessdata')
  })

  it('recognizes rendered text with the local eng traineddata', async () => {
    const canvas = createCanvas(400, 120)
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, 400, 120)
    context.fillStyle = '#000000'
    context.font = 'bold 48px sans-serif'
    context.fillText('Hello 123', 20, 80)
    const png = new Uint8Array(canvas.toBuffer('image/png'))
    const text = await ocrImagePng(png)
    expect(text).toContain('123')
  }, 30_000)
})
