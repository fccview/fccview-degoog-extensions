import * as cheerio from "cheerio";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0",
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const ANONYMOUS_VIEW_BASE = "https://www.startpage.com/do/d/search";

export const outgoingHosts = ["www.startpage.com", "startpage.com"];

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
    const url = `https://www.startpage.com/sp/search?${params.toString()}`;
    const doFetch = context?.fetch ?? fetch;
    const response = await doFetch(url, {
      headers: { "User-Agent": getRandomUserAgent() },
      method: "GET",
    });
    const html = await response.text();
    const $ = cheerio.load(html);
    const results = [];

    $(".result").each((_, el) => {
      const $el = $(el);
      const link = $el.find("h2 a, a.result-link").first();
      let href = link.attr("href") ?? "";
      const title = link.text().trim();
      const snippetEl = $el.find(".result-description, .result-snippet").first();
      const snippet = snippetEl.text().trim();

      if (href.includes("startpage.com/do/")) {
        try {
          const u = new URL(href, "https://www.startpage.com");
          const target = u.searchParams.get("url");
          if (target) href = decodeURIComponent(target);
        } catch {
          //
        }
      }

      if (title && href && href.startsWith("http")) {
        if (this.useAnonymousView) {
          href = `${ANONYMOUS_VIEW_BASE}?url=${encodeURIComponent(href)}`;
        }
        results.push({
          title,
          url: href,
          snippet: snippet || "",
          source: this.name,
        });
      }
    });

    return results;
  }
}
