import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { extractFileText, shouldExtractText } from '../src/text.ts'

const PDF_BYTES = Uint8Array.from(Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>/Contents 4 0 R>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 120 700 Td (Hello PDF) Tj ET\nendstream endobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n0000000186 00000 n \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n278\n%%EOF',
  'latin1',
))

async function docxBytes(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body></w:document>')
  return new Uint8Array(await zip.generateAsync({ type: 'nodebuffer' }))
}

async function xlsxBytes(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Age</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Ada</t></is></c><c r="B2"><v>36</v></c></row></sheetData></worksheet>')
  return new Uint8Array(await zip.generateAsync({ type: 'nodebuffer' }))
}

async function pptxBytes(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('ppt/slides/slide1.xml', '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello PPTX</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>')
  return new Uint8Array(await zip.generateAsync({ type: 'nodebuffer' }))
}

describe('document text extraction', () => {
  it('extracts PDF text', async () => {
    expect(shouldExtractText('application/pdf', 'a.pdf')).toBe(true)
    await expect(extractFileText(PDF_BYTES, 'application/pdf', 'a.pdf')).resolves.toContain('Hello PDF')
  })

  it('extracts DOCX text', async () => {
    const bytes = await docxBytes()
    expect(shouldExtractText('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toBe(true)
    await expect(extractFileText(bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx'))
      .resolves.toContain('Hello DOCX')
  })

  it('extracts XLSX rows as tab-separated lines', async () => {
    const bytes = await xlsxBytes()
    const text = await extractFileText(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx')
    expect(text).toContain('Name\tAge')
    expect(text).toContain('Ada\t36')
  })

  it('extracts PPTX slide text', async () => {
    const bytes = await pptxBytes()
    const text = await extractFileText(bytes, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'a.pptx')
    expect(text).toContain('Hello PPTX')
  })

  it('returns undefined for opaque binaries like archives', async () => {
    const bytes = Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 1, 2, 3)
    expect(shouldExtractText('application/zip', 'a.zip')).toBe(false)
    await expect(extractFileText(bytes, 'application/zip', 'a.zip')).resolves.toBeUndefined()
  })

  it('caps long extractions with a truncation marker', async () => {
    const bytes = Uint8Array.from(Buffer.from('x'.repeat(250_000)))
    const text = await extractFileText(bytes, 'text/plain', 'big.txt')
    expect(text).toContain('…[truncated')
  })
})
