<!-- DOCTOC SKIP -->

# Notices

## build

```bash
emcc upload_engine.cpp -std=c++20 -O3 \
  -s STANDALONE_WASM=1 \
  -s EXPORTED_FUNCTIONS='["_wasm_alloc","_wasm_free","_wasm_handle_message"]' \
  -o upload_engine.wasm
```

```bash
emcc upload_engine.cpp -std=c++20 -O3 \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_wasm_handle_message"]' \
  -s EXPORTED_RUNTIME_METHODS='["cwrap","getValue","setValue"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=128MB \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT="web,worker" \
  -o upload_engine.mjs
```

## TODOS

the app already covers login, chunking, parallel uploads, PUT/POST modes, and a polished UI. Below are prioritized, practical improvements and extensions that reduce failure modes, harden security, improve UX, and make the system production‑ready.

### Comparison of suggestions

| Feature                                        | Impact | Effort | Risk   |
| ---------------------------------------------- | ------ | ------ | ------ |
| Reliable retry + backoff + idempotency         | High   | Medium | Low    |
| Server-side upload session / resumable uploads | High   | High   | Medium |
| Stronger error reporting and observability     | High   | Low    | Low    |
| Token refresh and secure storage               | High   | Medium | Medium |
| Per-file metadata editing in UI                | Medium | Low    | Low    |
| Content-Range and partial PUT support          | Medium | Medium | Medium |
| Rate limiting and concurrency control          | Medium | Low    | Low    |
| End-to-end tests and CI build                  | High   | Medium | Low    |
| Progressive enhancement for slow networks      | Medium | Low    | Low    |
| Server-side validation and virus scanning      | High   | High   | Medium |

### Detailed Recommendations

#### Reliability and correctness

- Deterministic retries with exponential backoff\  
  Implement per‑chunk retry counters, exponential backoff with jitter, and a maximum retry limit. Mark chunks idempotently on the server (chunk IDs or offsets) so retries are safe.
- Idempotent chunk API\
  Ensure the server accepts repeated chunk uploads without duplicating data. Use chunk identifiers and server‑side deduplication.
- Resumable upload sessions\
  Add a server session token returned at job start. Worker should persist session state in memory and allow resuming after transient failures or page reloads (optionally via short‑lived session cookie or localStorage with strict expiry).
- Content-Range support\  
  For PUT flows, support Content-Range headers so servers that expect ranges can assemble files reliably.

### Security and auth

- Token refresh flow\
  Implement refresh tokens or a silent refresh endpoint so long uploads don’t fail when the JWT expires mid‑upload. Keep refresh tokens server‑side or in secure httpOnly cookies.
- Least privilege tokens\
  Issue upload tokens scoped to the job and limited lifetime. Avoid long‑lived global tokens.
- CSRF and CORS hardening\
  Ensure CORS policies are tight and server validates Origin. Use same‑site cookies for refresh tokens where possible.
- Avoid storing secrets in persistent storage\
  Keep JWTs in memory; if you must persist, encrypt and limit lifetime.

### Observability and error handling

- Structured client logs\
  Emit structured events for chunk start, success, failure, retry, and job completion. Allow toggling verbose logs in UI.
- Server telemetry\
  Record chunk latency, failure reasons, and client IPs. Surface aggregated metrics (errors per 1000 chunks, average chunk latency).
- User‑facing error messages\
  Map low‑level errors to actionable messages (network down, auth expired, server error, file too large).

### UX and features

- Per‑file metadata editing\
  Let users edit the path or title per file before upload. Provide bulk-edit shortcuts and preview of final paths.
- Drag‑drop folder tree preview\
  Show a small tree view for directory uploads and allow excluding files.
- Pause / resume / cancel\
  Add UI controls to pause and resume the worker queue and to cancel a job cleanly.
- Bandwidth awareness\
  Detect network speed and adapt max_parallel and chunk size automatically.
- Progress persistence\
  Show historical upload attempts and allow retrying failed jobs from the UI.

### Performance and scalability

- Adaptive chunk sizing\
  Start with a moderate chunk size and increase for fast networks; decrease for slow networks or high failure rates.
- Client-side throttling\
  Respect server signals (429, Retry‑After) and back off globally across concurrent uploads.
- Batching metadata calls\
  If you need to register many files, batch metadata requests to reduce round trips.
