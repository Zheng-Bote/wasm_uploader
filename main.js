// main.js
// Exposes default export with hooks used by the UI glue in index.html
// Also sets window.onFilesSelected, window.onStartUpload, window.onLogin, window.onLogout for backward compatibility.

const worker = new Worker("./upload_worker.js", { type: "module" });

const fileInput = document.getElementById("fileInput");
const uploadPathInput = document.getElementById("uploadPath");
const progressFill = document.getElementById("progressFill");
const progressPercent = document.getElementById("progressPercent");
const statusTextEl = document.getElementById("statusText");
const bytesText = document.getElementById("bytesText");
const tokenBox = document.getElementById("tokenBox");
const loginStatusEl = document.getElementById("loginStatus");
const startUploadBtn = document.getElementById("startUploadBtn");

let jwtToken = null;
let tokenExpiry = null;

// UI update helpers (also used by index.html glue)
function uiSetProgress(uploaded, total) {
  const pct = total ? Math.round((uploaded / total) * 100) : 0;
  if (progressFill) progressFill.style.width = pct + "%";
  if (progressPercent) progressPercent.textContent = pct + "%";
  if (statusTextEl) statusTextEl.textContent = pct ? "Uploading" : "Idle";
  if (bytesText) bytesText.textContent = `${uploaded} / ${total} bytes`;
}
function uiSetStatus(s) {
  if (statusTextEl) statusTextEl.textContent = s;
}
function uiSetToken(t) {
  jwtToken = t;
  if (tokenBox) tokenBox.textContent = maskToken(t);
}
function uiAppendLog(s) {
  const log = document.getElementById("log");
  if (log) log.innerHTML = `<div>${escapeHtml(s)}</div>` + log.innerHTML;
}
function uiEnableStart(v) {
  if (startUploadBtn) startUploadBtn.disabled = !v;
}

function maskToken(t) {
  if (!t) return "—";
  if (t.length < 20) return t.replace(/.(?=.{4})/g, "*");
  return t.slice(0, 6) + "…" + t.slice(-6);
}
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        m
      ],
  );
}

// Wire worker messages to UI
worker.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "PROGRESS") {
    const p = msg.payload || {};
    uiSetProgress(p.bytes_uploaded || 0, p.bytes_total || 0);
    if (p.job_done) uiSetStatus("Upload complete");
  } else if (msg.type === "PLAN_CREATED") {
    uiSetStatus("Upload started…");
  } else if (msg.type === "ERROR") {
    uiSetStatus("Error: " + (msg.payload?.message || "Unknown"));
    uiAppendLog("ERROR: " + (msg.payload?.message || "Unknown"));
  } else {
    // generic log
    uiAppendLog("WASM: " + JSON.stringify(msg).slice(0, 200));
  }
};

// --- Login flow ---
async function doLogin(authUrl, username, password) {
  loginStatusEl.textContent = "Logging in…";
  loginStatusEl.style.color = "#000";
  try {
    const res = await fetch(authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Login failed (${res.status}) ${txt}`);
    }
    const data = await res.json();
    if (!data.token) throw new Error("No token in response");
    jwtToken = data.token;
    uiSetToken(jwtToken);
    tokenExpiry = data.expires_in ? Date.now() + data.expires_in * 1000 : null;
    loginStatusEl.textContent = "Login successful";
    loginStatusEl.style.color = "#080";
    uiEnableStart(true);
    return true;
  } catch (err) {
    jwtToken = null;
    tokenExpiry = null;
    uiSetToken(null);
    loginStatusEl.textContent = "Login failed: " + err.message;
    loginStatusEl.style.color = "#b00";
    uiEnableStart(false);
    return false;
  }
}

// --- Upload orchestration ---
function prepareJobFromForm() {
  const files = fileInput.files;
  const uploadUrl = document.getElementById("uploadUrl").value;
  const parallel = parseInt(document.getElementById("parallel").value, 10) || 1;
  const httpMethod = document.getElementById("httpMethod").value || "PUT";
  const uploadPath = uploadPathInput.value.trim() || "";

  const job = {
    job_id: "job-" + Date.now(),
    upload_url: uploadUrl,
    http_method: httpMethod,
    upload_path: uploadPath,
    files: [],
    auth: { type: "bearer", token: jwtToken },
    chunking: {
      chunk_size: 4 * 1024 * 1024,
      max_parallel: parallel,
      max_retries: 3,
    },
  };

  const filesById = {};
  Array.from(files).forEach((f, idx) => {
    const file_id = `file-${idx}`;
    job.files.push({
      file_id,
      name: f.name,
      size: f.size,
      content_type: f.type || "application/octet-stream",
    });
    filesById[file_id] = f;
  });

  return { job, filesById };
}

async function startUploadFromUI() {
  if (!jwtToken) throw new Error("Not logged in");
  if (tokenExpiry && Date.now() > tokenExpiry) {
    jwtToken = null;
    uiEnableStart(false);
    throw new Error("Token expired");
  }

  const files = fileInput.files;
  if (!files || files.length === 0) throw new Error("No files selected");

  const { job, filesById } = prepareJobFromForm();
  uiSetProgress(
    0,
    job.files.reduce((s, f) => s + (f.size || 0), 0),
  );
  uiSetStatus("Initializing upload…");
  worker.postMessage({ type: "START_UPLOAD", payload: { job, filesById } });
  return true;
}

// --- File selection handler (suggest upload path) ---
function onFilesSelectedHandler(ev) {
  const files = ev?.target?.files || fileInput.files;
  if (!files || files.length === 0) return;
  const first = files[0];
  if (first.webkitRelativePath && first.webkitRelativePath.includes("/")) {
    const dir = first.webkitRelativePath.replace(/\/[^/]*$/, "");
    uploadPathInput.value = "/" + dir;
  } else {
    const name = first.name || "images";
    const base = name.replace(/\.[^/.]+$/, "");
    uploadPathInput.value = "/" + base;
  }
}

// --- Logout ---
function doLogout() {
  jwtToken = null;
  tokenExpiry = null;
  uiSetToken(null);
  uiEnableStart(false);
  uiSetStatus("Logged out");
}

// --- Expose functions for index.html glue and default export ---
window.onFilesSelected = onFilesSelectedHandler;
window.onStartUpload = startUploadFromUI;
window.onLogin = async function () {
  const authUrl = document.getElementById("authUrl").value.trim();
  const username = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  if (!authUrl || !username || !password) {
    loginStatusEl.textContent = "Please fill auth URL, email and password";
    loginStatusEl.style.color = "#b00";
    return false;
  }
  return await doLogin(authUrl, username, password);
};
window.onLogout = doLogout;

// Also expose a small API for UI updates if needed
window.__ui = window.__ui || {
  setProgress: uiSetProgress,
  setStatus: uiSetStatus,
  setToken: uiSetToken,
  appendLog: uiAppendLog,
  enableStart: uiEnableStart,
};

// Default export for ES module import in index.html
export default {
  onFilesSelected: onFilesSelectedHandler,
  onStartUpload: startUploadFromUI,
  onLogin: window.onLogin,
  onLogout: doLogout,
};
