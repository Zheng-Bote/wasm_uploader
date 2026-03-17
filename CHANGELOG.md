# Changelog
All notable changes to this project will be documented in this file.

The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-03-17
### Added
- Initial implementation of the WebAssembly‑driven parallel upload engine.
- C++ upload engine (`upload_engine.cpp`) using `nlohmann::json` for message handling.
- Emscripten build pipeline producing `upload_engine.mjs` and `upload_engine.wasm`.
- Web Worker (`upload_worker.js`) coordinating:
  - Chunk planning and scheduling via WASM.
  - Parallel uploads with configurable `max_parallel`.
  - Support for both **PUT** and **POST** upload modes.
  - POST multipart/form-data uploads with `photo` and `path` metadata.
  - Authorization header injection using JWT.
  - Robust JSON handling and dynamic output buffer resizing.
- Login flow with username/password → JWT retrieval.
- In‑memory JWT handling (no persistent storage).
- Modernized UI with:
  - Login panel.
  - File selection and drag‑and‑drop support.
  - Automatic path suggestion from directory uploads.
  - Editable global upload path.
  - Method selector (PUT/POST).
  - Progress bar, percentage display, and byte counters.
  - Activity log panel.
  - Masked JWT preview.
  - Responsive layout and improved styling.
- Error handling improvements:
  - Graceful handling of truncated WASM responses.
  - UTF‑8 validation and fallback parsing.
  - Clear user‑facing error messages.

### Changed
- Reworked `main.js` to expose a default export for ES module compatibility.
- Unified UI event handling and worker communication.
- Improved WASM output handling to avoid control characters and invalid JSON.
- Updated HTML structure to a more polished, responsive layout.

### Fixed
- JSON parsing errors caused by truncated or invalid WASM output.
- Missing `_malloc` / `_free` exports in Emscripten builds.
- Worker import errors due to missing default export in `main.js`.
- Occasional UI desynchronization during rapid chunk completion.

---

## Future Plans
These items are planned for upcoming releases:

- Upload pause/resume/cancel controls.
- Retry logic with exponential backoff and jitter.
- Resumable upload sessions with server‑side state.
- Per‑file metadata editing.
- Token refresh flow for long‑running uploads.
- Improved accessibility and keyboard navigation.
- Optional dark/light theme toggle.

---


