const STORAGE_KEYS = {
  serverUrl: "degoogFplayServerUrl",
  password: "degoogFplayPassword",
};

let ws;
let reconnectTimer = null;
let connectGeneration = 0;
let config = { serverUrl: "", password: "" };

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

async function loadConfig() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.serverUrl,
    STORAGE_KEYS.password,
  ]);
  config = {
    serverUrl:
      typeof data[STORAGE_KEYS.serverUrl] === "string"
        ? data[STORAGE_KEYS.serverUrl]
        : "",
    password:
      typeof data[STORAGE_KEYS.password] === "string"
        ? data[STORAGE_KEYS.password]
        : "",
  };
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

function detachWebSocket(socket) {
  if (!socket) return;
  socket.onclose = null;
  socket.onerror = null;
  socket.onmessage = null;
  socket.onopen = null;
  try {
    socket.close();
  } catch {}
}

function connect() {
  clearReconnectTimer();
  const gen = ++connectGeneration;
  const url = normalizeWebSocketUrl(config.serverUrl);

  if (!url) {
    if (ws) {
      const old = ws;
      ws = undefined;
      detachWebSocket(old);
    }
    return;
  }

  if (ws) {
    const old = ws;
    ws = undefined;
    detachWebSocket(old);
  }

  let socket;
  try {
    socket = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }

  ws = socket;

  socket.onopen = () => {
    if (gen !== connectGeneration) return;
    if (config.password) {
      socket.send(JSON.stringify({ type: "auth", password: config.password }));
    }
  };

  socket.onmessage = async (event) => {
    if (gen !== connectGeneration) return;
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === "auth_ok") {
      return;
    }

    if (msg.type === "ping") {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "pong" }));
      }
      return;
    }

    if (msg.type === "get_session") {
      try {
        const tab = await chrome.tabs.create({ url: msg.url, active: false });

        await new Promise((resolve) => {
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          });
        });

        const cookies = await chrome.cookies.getAll({ url: msg.url });
        await chrome.tabs.remove(tab.id);

        if (gen === connectGeneration && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "session", id: msg.id, cookies }));
        }
      } catch (e) {
        if (gen === connectGeneration && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "error",
              id: msg.id,
              error: e.message,
            }),
          );
        }
      }
    }
  };

  socket.onclose = () => {
    if (gen !== connectGeneration) return;
    if (ws === socket) ws = undefined;
    scheduleReconnect();
  };

  socket.onerror = () => {
    if (gen !== connectGeneration) return;
    socket.close();
  };
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.serverUrl) ||
    Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.password)
  ) {
    loadConfig().then(() => connect());
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "getStatus") {
    const normalized = normalizeWebSocketUrl(config.serverUrl);
    sendResponse({
      ready: ws !== undefined && ws.readyState === WebSocket.OPEN,
      hasUrl: Boolean(normalized),
    });
    return true;
  }
  return false;
});

loadConfig().then(() => connect());
