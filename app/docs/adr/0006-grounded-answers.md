# ADR 0006: Grounded answers and AI providers

Status: accepted (Phase 6)

## Context
Phases 4 and 5 produce cited evidence (keyword + local semantic). Phase 6 lets a language model write an answer from that evidence. It must work with a local model (Ollama) and with cloud providers (Anthropic, OpenAI) without ever choosing a cloud provider for the user.

## Decisions
**Provider interface.** `LanguageModelProvider` (`validate`, `probe`, `stream`, `capabilities`) normalises every vendor to `delta` / `done{finish, usage}` events and a closed set of `ProviderError` codes. Model ids are user-entered, never hard-coded. There is no fallback: if the selected provider fails, the user sees the error; no other provider is tried.
**Adapters.** Ollama: `fetch` + NDJSON, loopback addresses only, redirects refused. Anthropic and OpenAI: the official SDKs (Messages stream; Responses API with `store:false`). Base URLs are pinned in code so `*_BASE_URL` environment variables cannot redirect a key. No sampling parameters are sent (some models reject them). SDK retries are bounded (2).
**Keys.** Electron `safeStorage` (async API) in the main process, file `ai-credentials.json` in userData. No plaintext fallback: if encryption is unavailable (or Linux `basic_text`), saving is refused. The renderer can save or remove a key and sees only `none | configured | unreadable` plus a timestamp. Windows DPAPI protects against other OS users and copied files, not against other processes of the same user.
**Consent.** A cloud provider can be selected only after an explicit acknowledgement that the question, retrieved passages and recent conversation are sent to it. Revoking the acknowledgement deselects the provider. The renderer CSP keeps `connect-src 'none'`: all network calls are made by the main process.
**Grounding.** Question → Phase 5 hybrid retrieval (plus a stop-word-free keyword fallback) → evidence selection (re-read from the database, de-duplicated, ≤1200 chars per passage, budget by provider, ≤6 sources local / ≤10 cloud) → prompt with stable ids `[S1]…` → stream. With no evidence, a fixed message is stored and no model is called.
**Prompt injection.** The system prompt states that evidence is untrusted data, never instructions; evidence is XML-escaped inside `<evidence>`; history is trimmed and has its citation markers stripped. This reduces, but cannot eliminate, injection risk.
**Citations.** Markers `[S1]` / `[S1, S2]` are validated against the sources actually sent. Unknown ids are shown struck through and are never links; sentences without a valid citation are counted and flagged. Nothing is labelled "verified": a valid marker proves the source was supplied, not that the claim is right. PDF pages are one-based.
**Persistence.** Migration 0005: `conversations`, `messages` (status complete/cancelled/error, provider, model, finish, usage, source snapshot, check) and `ai_settings`. Only cited sources are snapshotted; availability is resolved on read.
**Streaming.** One generation at a time; events travel on the `ai:event` push channel; cancel and a 300 s hard timeout keep the partial text; errors keep partial text with status `error`. Prompts, answers and keys are not logged.

## Not done / limits
No real-provider request has been verified (no key, no Ollama in the build environment): all provider tests use mocked wire formats. Decisions are not retrievable by Phase 5 retrieval. Answers render as plain text (no Markdown). Follow-up questions retrieve using only the current question.
