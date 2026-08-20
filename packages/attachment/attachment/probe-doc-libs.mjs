import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = join(process.cwd(), 'probe-out')
mkdirSync(out, { recursive: true })

// --- pdfjs-dist v6 ---
try {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>/Contents 4 0 R>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 120 700 Td (Hello PDF) Tj ET\nendstream endobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n0000000186 00000 n \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n278\n%%EOF',
    'latin1',
  )
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, useSystemFonts: true }).promise
  let text = ''
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    text += content.items.map((i) => i.str).join(' ')
  }
  writeFileSync(join(out, 'pdf.txt'), text)
  console.log('pdfjs OK:', JSON.stringify(text))
} catch (error) {
  console.log('pdfjs FAIL:', error.message)
}

// --- mammoth ---
try {
  const mammoth = await import('mammoth')
  // minimal docx: zip with word/document.xml
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body></w:document>')
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  const result = await mammoth.extractRawText({ buffer })
  writeFileSync(join(out, 'docx.txt'), result.value)
  console.log('mammoth OK:', JSON.stringify(result.value.trim()))
} catch (error) {
  console.log('mammoth FAIL:', error.message)
}

// --- read-excel-file v9 ---
try {
  const xlsx = await import('read-excel-file/node')
  console.log('read-excel-file keys:', Object.keys(xlsx).join(','))
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Age</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Ada</t></is></c><c r="B2"><v>36</v></c></row></sheetData></worksheet>')
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  const rows = await xlsx.readSheet(buffer)
  writeFileSync(join(out, 'xlsx.txt'), JSON.stringify(rows))
  console.log('xlsx OK:', JSON.stringify(rows))
} catch (error) {
  console.log('xlsx FAIL:', error.message)
}
