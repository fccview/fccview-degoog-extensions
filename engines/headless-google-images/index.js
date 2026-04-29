import * as cheerio from "cheerio";

export const outgoingHosts = ["www.google.com"];
export const type = "images";

const SEARCH_URL = "https://www.google.com/search";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0",
];

const TBS_MAP = {
  day: "qdr:d",
  week: "qdr:w",
  month: "qdr:m",
  year: "qdr:y",
};

const _randomUserAgent = () =>
  USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const _isCaptchaPage = (html) =>
  /\/sorry\/index|id="captcha-form"|g-recaptcha|solveSimpleChallenge/i.test(
    html,
  );

const _extractIschjJson = (html) => {
  const idx = html.indexOf('{"ischj":');
  if (idx === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let quote = null;
  for (let i = idx; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (c === "\\") esc = true;
      else if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(idx, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
};

const _fromIschjData = (data, sourceName) => {
  const metadata = data?.ischj?.metadata ?? [];
  return metadata
    .map((item) => {
      const title = (item.result?.page_title ?? "").replace(/<[^>]+>/g, "");
      const url = item.result?.referrer_url ?? "";
      const thumbnail = item.thumbnail?.url ?? "";
      const imageUrl = item.original_image?.url ?? thumbnail;
      if (!title || !url) return null;
      return {
        title,
        url,
        snippet: item.result?.site_title ?? "",
        source: sourceName,
        thumbnail,
        imageUrl,
      };
    })
    .filter(Boolean);
};

const _resolveContainerData = ($, container) => {
  const img = container.find("img").first();
  const thumbnail = img.attr("src") ?? img.attr("data-src") ?? "";
  const title = img.attr("alt") ?? "";

  const imgresAnchor = container.find('a[href*="imgurl="]').first();
  let sourceUrl = "";
  let imageUrl = thumbnail;

  if (imgresAnchor.length) {
    try {
      const u = new URL(imgresAnchor.attr("href") ?? "", SEARCH_URL);
      sourceUrl = u.searchParams.get("imgrefurl") ?? "";
      imageUrl = u.searchParams.get("imgurl") ?? thumbnail;
    } catch { }
  }

  if (!sourceUrl) {
    const directAnchor = container
      .find("a[href]")
      .filter((_, a) => {
        const href = $(a).attr("href") ?? "";
        return href.startsWith("http") && !href.includes("google.com");
      })
      .first();
    sourceUrl = directAnchor.attr("href") ?? "";
  }

  return { thumbnail, imageUrl, sourceUrl, title };
};

const _fromDom = ($, sourceName) => {
  const results = [];
  $("[data-ri]").each((_, el) => {
    const { thumbnail, imageUrl, sourceUrl, title } = _resolveContainerData(
      $,
      $(el),
    );
    if (!thumbnail || !sourceUrl) return;
    results.push({
      title: title || sourceUrl,
      url: sourceUrl,
      snippet: title ?? "",
      source: sourceName,
      thumbnail,
      imageUrl,
    });
  });
  return results;
};

export default class HeadlessGoogleImagesEngine {
  name = "Google Images (Headless)";
  bangShortcut = "gih";
  safeSearch = "off";

  settingsSchema = [
    {
      key: "safeSearch",
      label: "Safe Search",
      type: "select",
      options: ["off", "on"],
      description: "Filter explicit content from image results.",
    },
  ];

  configure(settings) {
    if (typeof settings.safeSearch === "string") {
      this.safeSearch = settings.safeSearch;
    }
  }

  async executeSearch(query, page = 1, timeFilter, context) {
    const doFetch = context?.fetch ?? fetch;
    const ijn = Math.max(0, (page ?? 1) - 1);

    const params = new URLSearchParams({
      q: query,
      source: "hp",
      sclient: "img",
      udm: "2",
      uact: "5",
      ijn: String(ijn),
    });

    if (TBS_MAP[timeFilter]) params.set("tbs", TBS_MAP[timeFilter]);
    if (context?.lang) params.set("hl", context.lang);
    if (this.safeSearch === "on") params.set("safe", "active");

    let response;
    try {
      response = await doFetch(`${SEARCH_URL}?${params.toString()}`, {
        headers: {
          "User-Agent": _randomUserAgent(),
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language":
            context?.buildAcceptLanguage?.() ?? "en-US,en;q=0.9",
          Cookie: "CONSENT=YES+cb.20210328-17-p0.en+FX+710",
          Referer: "https://www.google.com/",
        },
        cloakbrowser: {
          warmup: {
            url: "https://www.google.com/",
            waitUntil: "domcontentloaded",
            dwellMs: 1500,
          },
          dwellMs: 600,
        },
      });
    } catch {
      return [];
    }

    if (!response.ok) return [];

    const html = await response.text();

    if (_isCaptchaPage(html)) {
      console.warn(
        `[${this.name}] Google returned a captcha/sorry page; transport IP may be flagged or cookies missing.`,
      );
      return [];
    }

    const ischjData = _extractIschjJson(html);
    if (ischjData) {
      const results = _fromIschjData(ischjData, this.name);
      if (results.length > 0) return results;
    }

    const $ = cheerio.load(html);
    return _fromDom($, this.name);
  }
}
