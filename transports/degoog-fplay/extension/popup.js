const STORAGE_KEYS = {
  serverUrl: "degoogFplayServerUrl",
  password: "degoogFplayPassword",
};

function normalizeWebSocketUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  let u = trimmed;
  if (/^https:\/\//i.test(u)) u = u.replace(/^https:/i, "wss:");
  else if (/^http:\/\//i.test(u)) u = u.replace(/^http:/i, "ws:");
  else if (!/^wss?:\/\//i.test(u)) u = `ws://${u}`;
  try {
    new URL(u);
    return u;
  } catch {
    return "";
  }
}

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = "ext-test-result";
  if (kind === "ok") el.classList.add("ext-test-ok");
  else if (kind === "err") el.classList.add("ext-test-fail");
}

async function refreshStatus(statusEl) {
  try {
    const r = await chrome.runtime.sendMessage({ type: "getStatus" });
    if (!r?.hasUrl) {
      setStatus(statusEl, "Enter server URL");
      return;
    }
    if (r.ready) {
      setStatus(statusEl, "Connected", "ok");
    } else {
      setStatus(statusEl, "Connecting…");
    }
  } catch {
    setStatus(statusEl, "Could not read status", "err");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("fplay-form");
  const serverInput = document.getElementById("server-url");
  const passwordInput = document.getElementById("password");
  const statusEl = document.getElementById("status");

  chrome.storage.local
    .get([STORAGE_KEYS.serverUrl, STORAGE_KEYS.password])
    .then((data) => {
      if (typeof data[STORAGE_KEYS.serverUrl] === "string") {
        serverInput.value = data[STORAGE_KEYS.serverUrl];
      }
      if (typeof data[STORAGE_KEYS.password] === "string") {
        passwordInput.value = data[STORAGE_KEYS.password];
      }
      refreshStatus(statusEl);
    });

  let poll;
  const startPoll = () => {
    if (poll) clearInterval(poll);
    poll = setInterval(() => refreshStatus(statusEl), 2000);
  };
  startPoll();
  window.addEventListener("unload", () => {
    if (poll) clearInterval(poll);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const rawUrl = serverInput.value;
    const normalized = normalizeWebSocketUrl(rawUrl);
    if (!normalized) {
      setStatus(statusEl, "Invalid server URL", "err");
      return;
    }
    chrome.storage.local.set(
      {
        [STORAGE_KEYS.serverUrl]: rawUrl.trim(),
        [STORAGE_KEYS.password]: passwordInput.value,
      },
      () => {
        setStatus(statusEl, "Saved", "ok");
        refreshStatus(statusEl);
      },
    );
  });
});
