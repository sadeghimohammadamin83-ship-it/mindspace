# ADR 0004: Document ingestion and full-text search (Phase 4)

## Decision
- **Parser:** `pdfjs-dist` 6.4 (Apache-2.0, Mozilla, actively maintained; pure JS, no native rebuild; requires Node >= 22.13, Electron 44 ships Node 24). Legacy build, run with font loading, system fonts and XFA disabled. Text only; no rendering, no OCR.
- **Formats:** PDF, TXT, Markdown (`.md`, `.markdown`). DOCX deferred (optional in the brief).
- **Where extraction runs:** a `worker_threads` worker (`src/main/documents/pdf-worker.ts`, bundled via electron-vite `?modulePath`) so the main process keeps answering IPC. 120 s timeout. TXT/MD are decoded in main (small, bounded).
- **Import:** `docs:import` takes no argument. Main opens the native dialog, reads each file once, validates extension, size, `%PDF-` magic / strict UTF-8 (no NUL), hashes with SHA-256, and writes the same bytes to `userData/documents/<doc-id>.<ext>` (`wx`). The source path is never stored; the original is never written.
- **Duplicates:** same SHA-256 → `duplicate` result pointing at the existing record; nothing is overwritten.
- **Schema (migration 0003):** `documents`, `document_pages` (one row per PDF page, one row for TXT/MD; FK cascade), FTS5 `search_index(title, body, kind, ref_id, page)` with `unicode61 remove_diacritics 2`.
- **Normalisation:** the index stores normalised text (`shared/search-text.ts`: NFKC per char + Phase 2 `normalizeText`: ي/ى→ی, ك→ک, diacritics, ZWNJ, digits, case). Stored page text is the extracted original. Snippets are cut from the original via an offset map; highlights are character ranges, rendered as text.
- **Sync:** explicit, one path per source: item writes in `items` repo; document pages in the same transaction that marks the document `indexed`/`no_text`. Removal deletes index rows in the same transaction. `search_index` is derived and can be rebuilt (`search:rebuild`, and automatically at start-up when counts disagree, e.g. first start after the migration).
- **Status model:** imported → processing → indexed | no_text | failed (error code). Start-up recovery marks leftover `processing`/`imported` as `failed: interrupted`, deletes orphaned managed files (only names matching `doc-<uuid>.<ext>`), flags rows whose copy vanished (`missing_file`). A failed reprocess keeps the previous text.
- **Query:** normalised letter/digit terms, each double-quoted, last one as prefix, ANDed; bm25 (title ×5). User text never reaches FTS syntax or SQL.

## Limits
PDF 50 MB, TXT/MD 5 MB, 2000 pages, 20 M extracted characters, 50 files per import, search text 200 chars, 50 results per page.

## Known limitations
RTL text in PDFs depends on pdf.js bidi handling of the file's content order; text extraction does not reproduce layout; no OCR; DOCX not supported; deleting index rows filters an UNINDEXED column (scan of the FTS table; fine at desktop scale).
