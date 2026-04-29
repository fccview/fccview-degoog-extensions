const WAIT_UNTIL_MAP = {
  load: "load",
  domcontentloaded: "domcontentloaded",
  networkidle: "networkidle",
};

const _REACT_HYDRATION = /<!--\$\??!?-->|<!--\/\$\??!?-->/g;
const _SHADOW_TEMPLATE =
  /<template\s+shadowroot(?:mode)?="[^"]*"[^>]*>([\s\S]*?)<\/template>/gi;

const _normalizeHtml = (html) => {
  if (!html) return html;
  return html.replace(_REACT_HYDRATION, "").replace(_SHADOW_TEMPLATE, "$1");
};

const _registrableDomain = (hostname) => {
  if (!hostname || /^[\d.]+$/.test(hostname) || !hostname.includes(".")) {
    return hostname;
  }
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join(".");
};

const _parseCookies = (cookieHeader, url) => {
  if (!cookieHeader) return [];
  let domain = "";
  try {
    domain = `.${_registrableDomain(new URL(url).hostname)}`;
  } catch {}
  return cookieHeader
    .split(";")
    .map((part) => {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) return null;
      return {
        name: part.slice(0, eqIdx).trim(),
        value: part.slice(eqIdx + 1).trim(),
        domain,
        path: "/",
      };
    })
    .filter((c) => c && c.name && c.value);
};

const _pickHeader = (headers, name) => {
  if (!headers) return undefined;
  return headers[name] ?? headers[name.toLowerCase()];
};

const _originOf = (url) => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/`;
  } catch {
    return null;
  }
};

export default class CloakBrowserTransport {
  name = "cloakbrowser";
  displayName = "CloakBrowser";
  description =
    "Fetches pages through a self-hosted CloakBrowser service. CloakBrowser is a stealth Chromium build that patches bot-detection signals at the C++ level (navigator.webdriver, canvas fingerprint, CDP leaks). See the plugin's README.md for the full setup (Docker compose, server.js, configuration steps).";

  settingsSchema = [
    {
      key: "url",
      label: "CloakBrowser URL",
      type: "url",
      required: true,
      placeholder: "http://127.0.0.1:53322",
      description: "Base URL of your CloakBrowser service.",
    },
    {
      key: "warmupEnabled",
      label: "Warm up before request",
      type: "toggle",
      default: "false",
      description:
        "Visit the target origin first (with cookies/dwell carried into the real request) before scraping. Helps with sites that flag cold sessions.",
    },
    {
      key: "warmupDwellMs",
      label: "Warmup dwell (ms)",
      type: "number",
      placeholder: "1500",
      description: "How long to dwell on the warmup page before continuing.",
    },
    {
      key: "timeout",
      label: "Timeout (ms)",
      type: "number",
      placeholder: "15000",
      description: "Maximum time to wait for the page to load (3000–60000 ms).",
    },
    {
      key: "waitUntil",
      label: "Wait until",
      type: "select",
      options: ["load", "domcontentloaded", "networkidle"],
      default: "networkidle",
      description: "When to consider the page fully loaded.",
    },
    {
      key: "bypassProxy",
      label: "Bypass proxy for CloakBrowser endpoint",
      type: "toggle",
      default: "true",
      description:
        "Connect directly to the CloakBrowser service instead of routing through the degoog proxy.",
    },
  ];

  _url = "";
  _timeoutMs = 15000;
  _waitUntil = "networkidle";
  _bypassProxy = true;
  _warmupEnabled = false;
  _warmupDwellMs = 1500;

  configure(settings) {
    this._url = (settings.url || "").replace(/\/+$/, "").trim();
    this._bypassProxy = settings.bypassProxy !== "false";
    this._warmupEnabled = settings.warmupEnabled === "true";
    this._timeoutMs = Math.max(
      3000,
      Math.min(60000, Number(settings.timeout) || 15000),
    );
    this._warmupDwellMs = Math.max(
      0,
      Math.min(10000, Number(settings.warmupDwellMs) || 1500),
    );
    if (settings.waitUntil in WAIT_UNTIL_MAP) {
      this._waitUntil = settings.waitUntil;
    }
  }

  available() {
    return this._url.length > 0;
  }

  async fetch(url, options, context) {
    const doFetch = this._bypassProxy ? fetch : context.fetch;
    const headers = options?.headers ?? {};
    const cookieHeader = _pickHeader(headers, "Cookie");
    const cookies = _parseCookies(cookieHeader, url);
    const userAgent = _pickHeader(headers, "User-Agent");
    const acceptLanguage = _pickHeader(headers, "Accept-Language");
    const referer = _pickHeader(headers, "Referer");

    const payload = {
      url,
      gotoOptions: {
        waitUntil: WAIT_UNTIL_MAP[this._waitUntil] ?? "networkidle",
        timeout: this._timeoutMs,
      },
    };

    if (userAgent) payload.userAgent = userAgent;
    const extraHeaders = {};
    if (acceptLanguage) extraHeaders["Accept-Language"] = acceptLanguage;
    if (referer) {
      extraHeaders["Referer"] = referer;
      payload.referer = referer;
    }
    if (Object.keys(extraHeaders).length > 0)
      payload.setExtraHTTPHeaders = extraHeaders;
    if (cookies.length > 0) payload.cookies = cookies;

    if (this._warmupEnabled) {
      const origin = _originOf(url);
      if (origin && origin !== url) {
        payload.warmup = {
          url: origin,
          waitUntil: "domcontentloaded",
          dwellMs: this._warmupDwellMs,
        };
      }
    }

    let res;
    try {
      res = await doFetch(`${this._url}/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: options?.signal,
      });
    } catch {
      return new Response("", { status: 503 });
    }

    if (!res.ok) return new Response("", { status: res.status });

    const html = await res.text();
    return new Response(_normalizeHtml(html), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
