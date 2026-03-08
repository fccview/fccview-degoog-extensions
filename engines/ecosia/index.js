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

export const outgoingHosts = ["www.ecosia.org", "ecosia.org"];

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
      headers: { "User-Agent": getRandomUserAgent() },
    });
    const html = await response.text();
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
