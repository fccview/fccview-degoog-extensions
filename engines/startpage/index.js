const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0",
];

const BASE_URL = "https://www.startpage.com";
const SERP_MARKER = "React.createElement(UIStartpage.AppSerpWeb, {";

export const outgoingHosts = ["www.startpage.com", "startpage.com"];

const _getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const _extractSerpJson = (html) => {
  const idx = html.indexOf(SERP_MARKER);
  if (idx === -1) return null;
  const start = html.indexOf("{", idx + SERP_MARKER.length);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let quote = null;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

const _esc = (str) => {
  if (typeof str !== "string") return "";
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const _stripStartpageProxy = (url) => {
  if (typeof url !== "string" || !url) return url;
  try {
    const u = new URL(url, BASE_URL);
    if (u.pathname.includes("do/d/search")) {
      const dest = u.searchParams.get("url");
      if (dest) return dest;
    }
  } catch {}
  return url;
};

export default class StartpageEngine {
  name = "Startpage";
  bangShortcut = "sp";

  settingsSchema = [
    {
      key: "useAnonymousView",
      label: "Use Anonymous View",
      type: "toggle",
      description:
        "Open result links via Startpage's proxy so the destination site does not see your IP.",
    },
  ];

  useAnonymousView = false;

  configure(settings) {
    this.useAnonymousView =
      settings.useAnonymousView === true ||
      settings.useAnonymousView === "true";
  }

  async executeSearch(query, page = 1, _timeFilter, context) {
    const p = Math.max(0, (page || 1) - 1);
    const params = new URLSearchParams({ q: query, cat: "web" });
    if (p > 0) params.set("page", String(p + 1));
    const doFetch = context?.fetch ?? fetch;

    const response = await doFetch(`${BASE_URL}/sp/search?${params.toString()}`, {
      headers: {
        "User-Agent": _getRandomUserAgent(),
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
      method: "GET",
    });

    const html = await response.text();
    const jsonStr = _extractSerpJson(html);
    if (!jsonStr) return [];

    let data;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      return [];
    }

    const regions = data?.presenter?.regions;
    if (!regions) return [];

    const mainline = regions.mainline;
    if (!Array.isArray(mainline)) return [];

    const results = [];

    for (const block of mainline) {
      if (block?.display_type !== "web-google") continue;
      const items = block.results;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        let url = _stripStartpageProxy(item.clickUrl ?? item.url ?? "");

        if (!url || typeof url !== "string" || !url.startsWith("http"))
          continue;

        const title = _esc(item.title ?? "");

        if (!title) continue;

        const snippet = _esc(item.description ?? "");

        if (this.useAnonymousView && typeof item.anonViewUrl === "string" && item.anonViewUrl) {
          url = item.anonViewUrl;
        }

        results.push({
          title,
          url,
          snippet: snippet || "",
          source: this.name,
        });
      }
    }

    return results;
  }
}
