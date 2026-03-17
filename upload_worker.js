// upload_worker.js
// Erwartet upload_engine.mjs (Emscripten MODULARIZE=1, EXPORT_ES6=1) im selben Ordner

let Module = null;
let HEAPU8 = null;
let wasm_handle_message = null;

const enc = new TextEncoder();
const dec = new TextDecoder();

async function initWasm() {
  if (Module) return;
  const modFactory = await import("./upload_engine.mjs");
  Module = await modFactory.default({});
  HEAPU8 = Module.HEAPU8;

  if (
    typeof Module._malloc !== "function" ||
    typeof Module._free !== "function"
  ) {
    throw new Error(
      "Emscripten runtime missing _malloc/_free. Rebuild with EXPORTED_FUNCTIONS including _malloc and _free.",
    );
  }

  wasm_handle_message = Module.cwrap("wasm_handle_message", "number", [
    "number",
    "number",
    "number",
    "number",
  ]);
  console.log("WASM initialized");
}

function callWasmJsonSync(msg) {
  const jsonStr = JSON.stringify(msg);
  const bytes = enc.encode(jsonStr);
  const inLen = bytes.length;

  const inPtr = Module._malloc(inLen);
  HEAPU8.set(bytes, inPtr);

  let outCap = 64 * 1024;
  let outPtr = Module._malloc(outCap);
  let outLen = wasm_handle_message(inPtr, inLen, outPtr, outCap);

  if (outLen >= outCap) {
    Module._free(outPtr);
    const MAX_CAP = 4 * 1024 * 1024;
    while (outLen >= outCap && outCap < MAX_CAP) {
      outCap = Math.min(outCap * 2, MAX_CAP);
      outPtr = Module._malloc(outCap);
      outLen = wasm_handle_message(inPtr, inLen, outPtr, outCap);
      if (outLen < outCap) break;
      Module._free(outPtr);
    }
  }

  const actualLen = Math.min(outLen, outCap);
  const outBytes = HEAPU8.subarray(outPtr, outPtr + actualLen);

  let outStr;
  try {
    outStr = dec.decode(outBytes);
  } catch (e) {
    Module._free(inPtr);
    Module._free(outPtr);
    throw new Error("WASM response is not valid UTF-8");
  }

  Module._free(inPtr);
  Module._free(outPtr);

  try {
    return JSON.parse(outStr);
  } catch (e) {
    const trimmed = outStr.replace(/[\u0000-\u001F\u007F]+$/g, "");
    try {
      return JSON.parse(trimmed);
    } catch (e2) {
      throw new Error(
        "Invalid JSON from WASM: " +
          e2.message +
          " | raw (truncated): " +
          outStr.slice(0, 2000),
      );
    }
  }
}

async function uploadChunk(
  uploadUrl,
  auth,
  file,
  chunkReq,
  httpMethod = "PUT",
  job = {},
) {
  const { offset, size } = chunkReq;
  const blob = file.slice(offset, offset + size);

  const headers = new Headers();
  if (auth && auth.type === "bearer" && auth.token) {
    headers.set("Authorization", `Bearer ${auth.token}`);
  }

  const method = (httpMethod || "PUT").toUpperCase();

  if (method === "POST") {
    const form = new FormData();
    form.append("photo", blob, file.name);
    const pathValue = job && job.upload_path ? job.upload_path : file.name;
    form.append("path", pathValue);

    const res = await fetch(uploadUrl, {
      method: "POST",
      headers,
      body: form,
    });

    return { success: res.ok, status_code: res.status };
  } else {
    if (file.type) headers.set("Content-Type", file.type);

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers,
      body: blob,
    });

    return { success: res.ok, status_code: res.status };
  }
}

async function runUploadJob(job, filesById) {
  await initWasm();

  const firstResp = callWasmJsonSync({ type: "UPLOAD_JOB", payload: job });
  self.postMessage(firstResp);

  let queue = [];
  const pl = firstResp.payload || {};
  if (Array.isArray(pl.next_chunk_requests))
    queue.push(...pl.next_chunk_requests);

  const maxParallel = job.chunking?.max_parallel || 1;
  let active = 0;
  let jobDone = false;

  const launchMore = () => {
    while (!jobDone && active < maxParallel && queue.length > 0) {
      const req = queue.shift();
      const file = filesById[req.file_id];
      if (!file) {
        self.postMessage({
          type: "ERROR",
          payload: { message: `File not found for id ${req.file_id}` },
        });
        continue;
      }

      active++;
      (async () => {
        try {
          const uploadResult = await uploadChunk(
            job.upload_url,
            job.auth,
            file,
            req,
            job.http_method,
            job,
          );

          const resp = callWasmJsonSync({
            type: "CHUNK_RESULT",
            payload: {
              job_id: job.job_id,
              file_id: req.file_id,
              chunk_id: req.chunk_id,
              success: uploadResult.success,
              status_code: uploadResult.status_code,
            },
          });

          self.postMessage(resp);

          const payload = resp.payload || {};
          if (payload.job_done) jobDone = true;
          if (Array.isArray(payload.next_chunk_requests))
            queue.push(...payload.next_chunk_requests);
        } catch (e) {
          self.postMessage({ type: "ERROR", payload: { message: String(e) } });
        } finally {
          active--;
          if (!jobDone) launchMore();
        }
      })();
    }
  };

  launchMore();
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === "START_UPLOAD") {
    const { job, filesById } = msg.payload;
    runUploadJob(job, filesById);
    return;
  }

  try {
    await initWasm();
    const resp = callWasmJsonSync(msg);
    self.postMessage(resp);
  } catch (err) {
    self.postMessage({ type: "ERROR", payload: { message: String(err) } });
  }
};
