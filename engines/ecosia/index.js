import * as cheerio from "cheerio";

export const outgoingHosts = ["www.ecosia.org", "ecosia.org"];

const CLOUDFLARE_CHALLENGE_MARKER = "Just a moment";
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0",
];

const _getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const _getBrowserHeaders = () => {
  return {
    "User-Agent": _getRandomUserAgent(),
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
  };
}

export default class EcosiaEngine {
  name = "Ecosia";
  bangShortcut = "ecosia";

  async executeSearch(query, page = 1, _timeFilter, context) {
    const p = Math.max(0, (page || 1) - 1);
    const params = new URLSearchParams({ q: query });
    if (p > 0) params.set("p", String(p));
    const url = `https://www.ecosia.org/search?${params.toString()}`;
    const doFetch = context?.fetch ?? fetch;
    const response = await doFetch(url, {
      headers: _getBrowserHeaders(),
    });
    const html = await response.text();
    if (html.includes(CLOUDFLARE_CHALLENGE_MARKER)) {
      throw new Error(
        "Ecosia returned a Cloudflare challenge page; server-side requests are often blocked. Try another engine or use Ecosia in your browser.",
      );
    }
    const $ = cheerio.load(html);
    const results = [];

    $(".result").each((_, el) => {
      const $el = $(el);
      const link = $el.find('a[href^="http"]').first();
      const href = link.attr("href") ?? "";
      const title = link.text().trim();
      const snippetEl = $el.find(".result-snippet, .result-description").first();
      const snippet = snippetEl.text().trim();

      if (title && href && href.startsWith("http")) {
        try {
          const parsed = new URL(href);
          if (parsed.hostname === "www.ecosia.org") return;
        } catch {
          //
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
