import { createCanvas } from '@napi-rs/canvas'
import { createWorker } from 'tesseract.js'
import { fileURLToPath } from 'node:url'

console.log('canvas OK')
const canvas = createCanvas(400, 120)
const ctx = canvas.getContext('2d')
ctx.fillStyle = '#ffffff'
ctx.fillRect(0, 0, 400, 120)
ctx.fillStyle = '#000000'
ctx.font = 'bold 48px sans-serif'
ctx.fillText('Hello 123', 20, 80)
const png = canvas.toBuffer('image/png')
console.log('png bytes:', png.length)

const worker = await createWorker('eng', 1, {
  langPath: fileURLToPath(new URL('./assets/tessdata/', import.meta.url)),
  gzip: false,
})
const { data } = await worker.recognize(png)
console.log('OCR TEXT:', JSON.stringify(data.text.trim()))
await worker.terminate()
