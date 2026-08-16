# Native file attachments (image-equal, excluding audio/video)

Status: implemented (core + web client), deployed as the local fork under
`D:\DeepSeekHarness\fork`; installer regeneration is a follow-up.

## Document extraction (ChatGPT/Claude-style fast reads)

Uploaded PDF/DOCX/XLSX/PPTX are parsed server-side at admission and their
text rides the file block projection, so the model reads the document from
the first turn. Extractors: pdfjs-dist (PDF), mammoth (DOCX),
read-excel-file (XLSX), jszip + slide XML (PPTX). Caps: 200k projected
characters, 200 PDF pages, 2 000 XLSX rows, 100 PPTX slides. Audio/video and
opaque binaries (archives, executables) remain metadata-only.
Scope owner: local fork of deepseek-harness (master 47f9438)

## Problem

The current attachment path is image-only: `ctx.attachments` exposes
`validateImage/saveImage/readImage`, the composer intake rejects every
non-image file, and the session vocabulary has an `ImageBlock` but no generic
file block. Dragging a PDF or a ZIP into the composer is refused.

Goal: make arbitrary files (everything except audio/video) first-class
attachments with the same lifecycle as images — upload from the Web composer,
durable content-addressed storage, session-log representation, replayable
history, and a model-facing read path.

## Design

### 1. Attachment seam (`packages/attachment/attachment`)

Keep the image API untouched (compatibility). Add a parallel file API:

- `FileAttachmentRef { attachmentId, mediaType, bytes, name? }`
- `FileAttachmentLimits { maxFileBytes, maxFilesPerMessage, maxMessageFileBytes, allowedMediaTypes?, denyMediaTypes? }`
- `SaveFileAttachment { data, mediaType, name? }`, `StoredFileAttachment { ref, data }`
- `AttachmentStore.fileLimits`, `validateFile`, `saveFile`, `readFile`

Media policy: audio/video are refused by default (`denyMediaTypes` default
`['audio/*', 'video/*']`) plus a small magic-byte guard for common container
formats so a renamed `.mp4` is not smuggled in as `application/octet-stream`.

### 2. Local store (`packages/attachment/attachment-local`)

Extract the content-addressed object plumbing (`saveObject` / `readObject`)
already used by images, and reuse it for files. File validation checks size,
deny-list media type, and the audio/video magic guard. No full-format sniffing
in v1; the declared media type is stored and the model sees metadata plus
extracted text when the bytes decode as text.

### 3. Content vocabulary (`packages/llm/llm`)

Add a merge-extensible block:

```ts
interface FileBlock {
  type: 'file'
  attachment: FileAttachmentRef
  /** Server-side text projection when the bytes decode as UTF-8/UTF-16/GB18030 text. */
  text?: string
}
```

`contentHasFile` walks content like `contentHasImage`. New core block lands
with adapter, UI, and compaction support, per the `ContentBlockMap` contract.

### 4. Adapters

`llm-deepseek` (text-only wire): keep rejecting image blocks, but render file
blocks as text — metadata header plus `text` projection when present — instead
of dropping them. `llm-pi-ai` receives the same file text projection beside
its existing image path.

### 5. Host admission (`packages/host/apiproxy`)

`PromptContentPart` gains `{ type: 'file', mediaType, name?, data }`; prompt
admission enforces `fileLimits` (count, per-file, aggregate), saves each file
durably before the user event is appended, and attaches the extracted text.
The `attachment` RPC resolves file references authorized by the session and
returns verified bytes. A `fileLimits` projection mirrors `imageLimits`.

### 6. Model-facing tool (`packages/fs/tool-fs`)

`read_attachment { attachmentId }` reads a session-authorized attachment:
text-like bytes come back inline, opaque binaries come back as metadata.
Images keep using `read_image`.

### 7. Web client

Composer intake accepts any file except audio/video. Draft attachments carry
`kind: 'image' | 'file'`; file cards show name/size/type instead of a raster
thumbnail. History renders file blocks as a chip with a download action via the
authorized attachment RPC.

## Compatibility

- Existing image sessions, events, and storage layout are untouched.
- New sessions may mix image and file blocks in one message.
- Old readers (adapters, UI, export) see file blocks as a new block type; the
  merge-extensible switch fallthrough is the documented extension path.
- The npm-installed runtime is replaced by a local build for this fork; the
  installer package is regenerated from the fork.

## Tests

- store: file save/read/dedup/integrity, deny-list and magic guard
- admission: mixed image+file prompt, limits, text extraction projection
- serialize: file block text projection on the text-only wire
- client service: file draft creation, serialization, non-image rejection path

## Rollback

The fork builds into a separate app directory; reverting to the stock
`@deepseek-ai/dsh` package is a directory swap plus restart. Storage layout
adds only new objects under the existing `attachments/v1` tree.
