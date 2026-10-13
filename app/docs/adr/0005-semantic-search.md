# ADR 0005: Local semantic search and hybrid retrieval

Status: accepted (Phase 5)

## Context
Phase 4 gave keyword search (FTS5) over notes, documents and PDF pages. Phase 5 adds meaning-based retrieval that runs entirely on the user's computer, with no cloud API, no hosted chat model and no Ollama. "Ask Your Memory" becomes an evidence finder: it returns cited excerpts and never writes an answer.

## Decisions

**Model.** `Xenova/multilingual-e5-small`, ONNX int8 (`onnx/model_quantized.onnx`, 118 MB), pinned to revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`. It has 384 dimensions, a 512-token limit and is multilingual (Persian and English). The base model `intfloat/multilingual-e5-small` is MIT. The Xenova conversion repository has no license field in its card, which is recorded as a limitation. Inputs use the `query: ` / `passage: ` prefixes, mean pooling and L2 normalisation, as the model card specifies. The model id stored with every vector is `multilingual-e5-small@761b726dd34f/q8/v1`.

**Runtime.** `onnxruntime-node` 1.30.0 (MIT; CPU binaries bundled; the CUDA postinstall is skipped via `.npmrc`) and `@huggingface/tokenizers` 0.2.0 (Apache-2.0, pure JS). transformers.js was not used because it pulls in `sharp` and `onnxruntime-web`. Inference runs in a `worker_thread` (`embedding-worker.ts`), never on the Electron main or renderer thread.

**Batch size 1.** The int8 model quantises activations per call, so batched inputs gave vectors that differed by up to 0.011 per component from the same text embedded alone. One input per call makes stored vectors independent of their neighbours, and a test checks exact equality.

**Model files.** They are not bundled and never downloaded automatically. Settings → Semantic search has an explicit "Download and set up" action. The download goes from huggingface.co at the pinned revision into `userData/models/…`; every file is checked against its size and SHA-256 from `model-manifest.ts` before use, and `.part` files are renamed only after their hash matches. On later starts a `.verified.json` marker (size, mtime, hash) lets the app load the model without re-hashing. No document, query or vector is ever sent anywhere.

**Chunking.** Source-aware: notes are chunked from title + body + url; PDFs are chunked per page and a chunk never crosses a page boundary (1-based page numbers are stored per chunk); TXT/Markdown are chunked as one unit. Chunks are at most 900 characters with 150 characters of overlap, split at blank lines and headings first, then sentences (including Persian `؟` and `؛`), then whitespace. Each chunk stores its character offsets into the source text.

**Storage.** Migration 0004 adds `semantic_sources` (one row per note or document: content hash, source version, model id, status) and `semantic_chunks` (offsets, page, text, model id, dimensions and a float32 BLOB with a length check). Both cascade on delete from `items`/`documents`. Nothing is written to the vector tables outside a transaction per source.

**Vector search.** Exact cosine similarity over an in-memory `Float32Array` built lazily from the database and invalidated on every commit (about 1.5 KB of RAM per chunk; capped at 200,000 vectors). `sqlite-vec` 0.1.9 was considered and rejected: it is a pre-1.0 native extension, and exact search is fast enough at personal-library scale.

**Thresholds.** Measured on the real model with the synthetic evaluation set (`tests/unit/helpers/semantic-eval.ts`): the lowest correct top-1 score was 0.822, the highest unrelated-query score against notes was 0.799. Tuning: minimum similarity 0.81, results must be within 0.05 of the best hit, 60 candidates, at most 3 chunks per source.

**Hybrid ranking.** Reciprocal Rank Fusion (k = 60) of the Phase 4 FTS5 ranking and the vector ranking, fused at the source-location level (a note, a document, or one PDF page). Ties go to the keyword rank so exact identifiers stay first. When the model is not set up, hybrid falls back to keyword results and says so.

**Grounding.** At query time each semantic hit is checked against the live source: the chunk text must still equal the slice of the current note or page text at its stored offsets. Stale or deleted chunks are dropped, never shown. Excerpts are rendered as text (no HTML).

**Incremental indexing.** Each content change (note edit, import, reprocess, delete) schedules a debounced pass. A source is re-embedded only if its content hash changed; a change of model id makes all sources stale. A pass stops cleanly on shutdown and never marks a source done before its transaction commits; a source edited during embedding is redone in the next pass. Model errors stop the pass without marking sources failed; content errors mark only that source failed (retry from Settings).

**IPC.** Four channels with zod validation: `semantic:status`, `semantic:setup`, `semantic:rebuild`, `retrieve:run`. The renderer gets no database, SQL or file access.

## Measured (Linux container, 4 vCPU Xeon 2.1 GHz)
- Model load 1.3–2.5 s; one query embedding 3–18 ms; 12 notes + 2 PDFs (20 chunks) indexed in about 2.8 s.
- Top-1 on the evaluation set: English→English 7/7, Persian→Persian 5/5, English→Persian 4/4, Persian→English 1/3.

## Limitations
- Persian→English retrieval is weak with this small model.
- Persian queries score higher against Persian text in general: an unrelated Persian question returned the one Persian PDF page at 0.819, just above the floor.
- The Xenova repository has no explicit license field (the base model is MIT).
- Packaging (`asarUnpack` for the `.node` binaries) and Windows were not tested.
- PDF extraction drops ZWNJ (Phase 4 behaviour), which slightly changes Persian tokenisation.
