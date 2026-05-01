import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const FETCH_TIMEOUT_MS = 30000;
const SESSION_TTL_MS = 5 * 60 * 60 * 1000;
const COOKIE_JAR_DIR = join(tmpdir(), "degoog-fplay-cookies");
const DELIMITER = randomUUID();
const BINARIES = [
  "curl_firefox135",
  "curl_firefox133",
  "curl_ff133",
  "curl_ff117",
  "curl_ff",
];
const BASE_STRIP_HEADERS = new Set(["accept-encoding", "accept"]);

try {
  mkdirSync(COOKIE_JAR_DIR, { recursive: true });
} catch {}

let _server = null;
let _browser = null;
const _pending = new Map();
const _sessions = new Map();

const _cookieJarPath = (host) =>
  join(COOKIE_JAR_DIR, host.replace(/[^a-z0-9.-]/gi, "_") + ".txt");

function _resolveBinary() {
  for (const bin of BINARIES) {
    try {
      const r = Bun.spawnSync([bin, "--version"]);
      if (r.exitCode === 0) return bin;
    } catch {
      continue;
    }
  }
  return null;
}

function _startServer(port, password) {
  _server = Bun.serve({
    port,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("fplay transport", { status: 200 });
    },
    websocket: {
      open(ws) {
        ws.authenticated = !password;
        if (!password) _browser = ws;
        ws._ping = setInterval(
          () => ws.send(JSON.stringify({ type: "ping" })),
          20000,
        );
      },
      message(ws, raw) {
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }

        if (msg.type === "auth") {
          if (password && msg.password !== password) {
            ws.close(1008, "wrong password");
            return;
          }
          ws.authenticated = true;
          _browser = ws;
          ws.send(JSON.stringify({ type: "auth_ok" }));
          return;
        }

        if (!ws.authenticated) return;
        if (!password) _browser = ws;

        if (
          (msg.type === "session" || msg.type === "error") &&
          _pending.has(msg.id)
        ) {
          const { resolve, reject, timer } = _pending.get(msg.id);
          clearTimeout(timer);
          _pending.delete(msg.id);
          if (msg.type === "session") resolve(msg.cookies ?? []);
          else reject(new Error(msg.error ?? "fplay error"));
        }
      },
      close(ws) {
        clearInterval(ws._ping);
        if (_browser === ws) _browser = null;
      },
    },
  });
}

async function _getSession(host, warmupUrl) {
  const existing = _sessions.get(host);
  if (existing && Date.now() - existing.ts < SESSION_TTL_MS)
    return existing.cookies;

  if (!_browser) throw new Error("No browser connected to fplay transport.");

  const id = randomUUID();
  const cookies = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _pending.delete(id);
      reject(new Error("fplay session timeout"));
    }, FETCH_TIMEOUT_MS);
    _pending.set(id, { resolve, reject, timer });
    _browser.send(JSON.stringify({ type: "get_session", id, url: warmupUrl }));
  });

  console.log(
    `[fplay] got ${cookies.length} cookies for ${host}:`,
    cookies.map((c) => c.name).join(", "),
  );
  _sessions.set(host, { cookies, ts: Date.now() });
  return cookies;
}

async function _curlFetch(
  url,
  options,
  proxyUrl,
  binary,
  cookies,
  stripEngineCookies,
  stripEngineUserAgents,
) {
  const parsed = new URL(url);
  const cookieJar = _cookieJarPath(parsed.hostname);
  const method = options.method ?? "GET";

  const stripHeaders = new Set(BASE_STRIP_HEADERS);
  if (stripEngineUserAgents) stripHeaders.add("user-agent");

  const args = [
    "-sS",
    "-L",
    "--max-redirs",
    "5",
    "--max-time",
    "30",
    "-w",
    `\n${DELIMITER}%{http_code}`,
    "-c",
    cookieJar,
    "-b",
    cookieJar,
  ];

  if (cookies?.length) {
    const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    args.push("-H", `Cookie: ${cookieStr}`);
  }

  if (proxyUrl?.trim()) args.push("--proxy", proxyUrl.trim());
  if (method !== "GET" && method !== "HEAD") args.push("-X", method);

  for (const [k, v] of Object.entries(options.headers ?? {})) {
    const kl = k.toLowerCase();
    if (stripEngineCookies && kl === "cookie") continue;
    if (stripHeaders.has(kl)) continue;
    args.push(
      "-H",
      `${k.replace(/[\r\n]/g, "")}: ${String(v).replace(/[\r\n]/g, "")}`,
    );
  }

  args.push("--", url);

  const proc = Bun.spawn([binary, ...args], {
    stdin: options.body ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (options.body && ["POST", "PUT", "PATCH"].includes(method)) {
    try {
      proc.stdin.write(options.body);
      proc.stdin.end();
    } catch {
      proc.kill();
    }
  }

  const [stdoutBuf, stderrText, exitCode] = await Promise.all([
    Bun.readableStreamToBytes(proc.stdout),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0)
    throw new Error(
      stderrText.trim() || `curl-impersonate failed (${exitCode})`,
    );

  const output = new TextDecoder().decode(stdoutBuf);
  const delimIdx = output.lastIndexOf(`\n${DELIMITER}`);
  const bodyText = delimIdx >= 0 ? output.slice(0, delimIdx) : output;
  const statusNum = parseInt(
    delimIdx >= 0 ? output.slice(delimIdx + DELIMITER.length + 1) : "502",
    10,
  );

  return new Response(bodyText, {
    status: statusNum >= 100 ? statusNum : 502,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

_startServer(3031, "");

export default class FplayTransport {
  name = "degoog-fplay";
  displayName = "degoog-fplay (Requires browser extension)";
  description =
    "Uses a real browser extension to harvest session cookies, then passes them to curl-impersonate for the actual requests.";

  _port = 3031;
  _password = "";
  _stripEngineCookies = true;
  _stripEngineUserAgents = true;

  settingsSchema = [
    {
      key: "port",
      label: "WebSocket Port",
      type: "number",
      default: "3031",
      description: "Port degoog listens on for browser extension connections.",
    },
    {
      key: "password",
      label: "Password",
      type: "password",
      default: "",
      description:
        "Optional password — must match what you set in the extension.",
    },
    {
      key: "stripEngineCookies",
      label: "Strip engine cookies",
      type: "toggle",
      default: "true",
      description:
        "When on, ignore Cookie headers from engines so only the browser session (and curl jar) apply.",
    },
    {
      key: "stripEngineUserAgents",
      label: "Strip engine user agents",
      type: "toggle",
      default: "true",
      description:
        "When on, drop User-Agent from engines and use curl-impersonate’s profile only.",
    },
  ];

  configure(settings) {
    this._stripEngineCookies = settings.stripEngineCookies !== "false";
    this._stripEngineUserAgents = settings.stripEngineUserAgents !== "false";
    const newPort = parseInt(settings.port, 10) || 3031;
    const newPassword =
      typeof settings.password === "string" ? settings.password : "";
    if (newPort !== this._port || newPassword !== this._password) {
      this._port = newPort;
      this._password = newPassword;
      if (_server) {
        _server.stop(true);
        _server = null;
      }
      _startServer(this._port, this._password);
    }
  }

  available() {
    return _resolveBinary() !== null;
  }

  async fetch(url, options, context) {
    const binary = _resolveBinary();
    if (!binary)
      throw new Error(
        "curl-impersonate not found. Required by fplay transport.",
      );

    const parsed = new URL(url);
    const warmupUrl = `${parsed.protocol}//${parsed.hostname}/`;
    const cookies = await _getSession(parsed.hostname, warmupUrl);

    return _curlFetch(
      url,
      options,
      context.proxyUrl,
      binary,
      cookies,
      this._stripEngineCookies,
      this._stripEngineUserAgents,
    );
  }
}
