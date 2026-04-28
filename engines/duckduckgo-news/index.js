export const outgoingHosts = ["duckduckgo.com"];
export const type = "news";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0",
];

const _getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const _extractVqd = (html) => {
  const match = html.match(/vqd=['"]([^'"]+)['"]/);
  return match ? match[1] : null;
};

const _mapDfFilter = (timeFilter, dateFrom, dateTo) => {
  switch (timeFilter) {
    case "day":
      return "d";
    case "week":
      return "w";
    case "month":
      return "m";
    case "year":
      return "y";
    case "custom":
      if (dateFrom && dateTo) return `${dateFrom}..${dateTo}`;
      if (dateFrom) return `${dateFrom}..${dateFrom}`;
      return "";
    default:
      return "";
  }
};


const _buildKl = (lang) => {
  if (!lang) return "wt-wt";
  return `${lang}-${lang}`;
};

export default class DuckDuckGoNewsEngine {
  name = "DuckDuckGo News";
  bangShortcut = "ddgnews";
  safeSearch = "off";

  settingsSchema = [
    {
      key: "safeSearch",
      label: "Safe Search",
      type: "select",
      options: ["off", "moderate", "strict"],
      description: "Filter explicit content from news results.",
    },
  ];

  configure(settings) {
    if (typeof settings.safeSearch === "string") {
      this.safeSearch = settings.safeSearch;
    }
  }

  async executeSearch(query, page = 1, timeFilter, context) {
    const doFetch = context?.fetch ?? fetch;
    const ua = _getRandomUserAgent();
    const acceptLang = context?.buildAcceptLanguage?.() ?? "en-US,en;q=0.9";
    const headers = {
      "User-Agent": ua,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": acceptLang,
      "Accept-Encoding": "gzip, deflate, br",
    };

    const initRes = await doFetch(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iar=news&ia=news`,
      { headers },
    );
    const initHtml = await initRes.text();
    const vqd = _extractVqd(initHtml);
    if (!vqd) return [];

    const offset = ((page || 1) - 1) * 30;
    const safeMap = { off: "-1", moderate: "-1", strict: "1" };
    const params = new URLSearchParams({
      q: query,
      vqd,
      l: _buildKl(context?.lang),
      kl: _buildKl(context?.lang),
      o: "json",
      noamp: "1",
      p: safeMap[this.safeSearch] ?? "-1",
      s: String(offset),
    });

    const df = _mapDfFilter(timeFilter, context?.dateFrom, context?.dateTo);
    if (df) params.set("df", df);

    const res = await doFetch(`https://duckduckgo.com/news.js?${params.toString()}`, {
      headers: {
        ...headers,
        Accept: "application/json, text/javascript, */*; q=0.01",
        Referer: "https://duckduckgo.com/",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.results ?? [];

    return items
      .map((item) => ({
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: item.excerpt ?? item.body ?? "",
        source: item.source ?? this.name,
        ...(item.image ? { thumbnail: item.image } : {}),
      }))
      .filter((r) => r.title && r.url);
  }
}
