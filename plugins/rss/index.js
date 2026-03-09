const cheerio = require("cheerio");

const FEED_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CONCURRENCY = 5;
const MAX_ITEMS_PER_FEED = 50;
const MAX_CACHE_ENTRIES = 100;
const MAX_FEEDS_PER_REQUEST = 20;
const PAGE_SIZE = 20;

const DEFAULT_NEWS_FEED_URLS = [
  "https://news.ycombinator.com/rss",
  "https://techcrunch.com/feed/",
  "https://feeds.arstechnica.com/arstechnica/index",
  "https://www.wired.com/feed/rss",
  "https://feeds.bbci.co.uk/news/technology/rss.xml",
  "https://www.theverge.com/rss/index.xml",
  "https://www.engadget.com/rss.xml",
  "https://www.cnet.com/rss/news/",
  "https://www.zdnet.com/news/rss.xml",
  "https://gizmodo.com/rss",
  "https://www.technologyreview.com/feed/",
  "https://readwrite.com/feed/",
  "https://venturebeat.com/feed/",
  "https://thenextweb.com/feed/",
];

const cache = new Map();

let feedUrls = [];
let showOnDesktop = false;

function parseRssOrAtom(xml, feedUrl) {
  try {
    return parseRssOrAtomInner(xml, feedUrl);
  } catch {
    return { items: [], feedTitle: new URL(feedUrl).hostname };
  }
}

function parseRssOrAtomInner(xml, feedUrl) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const feedTitle =
    $("channel > title").first().text().trim() ||
    $("feed > title").first().text().trim() ||
    new URL(feedUrl).hostname;
  const items = [];

  $("channel > item, feed > entry").each((_, el) => {
    const $el = $(el);
    const title =
      $el.find("title").first().text().trim() ||
      $el.find("content").first().text().trim().slice(0, 200);
    let link =
      $el.find("link").first().attr("href") ||
      $el.find("link").first().text().trim();
    if (!link && $el.find("link").length) {
      const linkEl = $el.find("link").first();
      if (linkEl.attr("href")) link = linkEl.attr("href");
      else link = linkEl.text().trim();
    }
    const desc =
      $el.find("description").first().text().trim() ||
      $el.find("summary").first().text().trim() ||
      $el.find("content").first().text().trim() ||
      "";
    const pubDateStr =
      $el.find("pubDate").first().text().trim() ||
      $el.find("published").first().text().trim() ||
      $el.find("updated").first().text().trim() ||
      "";
    let pubDate = null;
    if (pubDateStr) {
      try {
        pubDate = new Date(pubDateStr);
        if (Number.isNaN(pubDate.getTime())) pubDate = null;
      } catch {
        pubDate = null;
      }
    }
    let thumbnail;

    const mediaImages = $el.find("media\\:content").filter(function () {
      return (
        $(this).attr("medium") === "image" ||
        /\.(jpe?g|png|webp|gif)/i.test($(this).attr("url") || "")
      );
    });

    if (mediaImages.length) {
      let bestUrl = mediaImages.first().attr("url") || "";
      let bestWidth =
        parseInt(mediaImages.first().attr("width") || "0", 10) || 0;
      mediaImages.each(function () {
        const w = parseInt($(this).attr("width") || "0", 10) || 0;
        if (w > bestWidth) {
          bestWidth = w;
          bestUrl = $(this).attr("url") || "";
        }
      });
      if (bestUrl && bestUrl.startsWith("http")) thumbnail = bestUrl;
    }

    if (!thumbnail) {
      const mediaThumb = $el.find("media\\:thumbnail").first();
      if (mediaThumb.length) {
        const url = mediaThumb.attr("url");
        if (url && url.startsWith("http")) thumbnail = url;
      }
    }

    if (!thumbnail) {
      const enclosure = $el
        .find("enclosure")
        .filter(function () {
          const t = $(this).attr("type") || "";
          return t.startsWith("image/");
        })
        .first();
      if (enclosure.length) {
        const encUrl = enclosure.attr("url");
        if (encUrl && encUrl.startsWith("http")) thumbnail = encUrl;
      }
    }

    if (!thumbnail) {
      const htmlContent =
        $el.find("content\\:encoded").first().text() ||
        $el.find("description").first().text() ||
        $el.find("content").first().text() ||
        "";
      const imgMatch = htmlContent.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch && imgMatch[1] && imgMatch[1].startsWith("http")) {
        thumbnail = imgMatch[1];
      }
    }
    if (title && link && link.startsWith("http")) {
      items.push({
        title,
        url: link,
        description: desc.replace(/<[^>]+>/g, "").slice(0, 500),
        source: feedTitle,
        pubDate,
        thumbnail,
      });
    }
  });

  return { items: items.slice(0, MAX_ITEMS_PER_FEED), feedTitle };
}

async function fetchFeed(url) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { items: cached.items, feedTitle: cached.feedTitle };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; degoog/1.0; +https://github.com/degoog)",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const xml = await res.text();
    const parsed = parseRssOrAtom(xml, url);
    cache.set(url, {
      items: parsed.items,
      feedTitle: parsed.feedTitle,
      fetchedAt: Date.now(),
    });
    if (cache.size > MAX_CACHE_ENTRIES) {
      let oldest = null;
      let oldestTime = Infinity;
      for (const [key, val] of cache) {
        if (val.fetchedAt < oldestTime) {
          oldestTime = val.fetchedAt;
          oldest = key;
        }
      }
      if (oldest) cache.delete(oldest);
    }
    return parsed;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

async function fetchAllFeeds(urls) {
  const capped = urls.slice(0, MAX_FEEDS_PER_REQUEST);
  const all = [];
  for (let i = 0; i < capped.length; i += CONCURRENCY) {
    const batch = capped.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((u) => fetchFeed(u)));
    for (const r of results) {
      if (r) all.push(...r.items);
    }
  }
  all.sort((a, b) => {
    const ta = a.pubDate?.getTime() ?? 0;
    const tb = b.pubDate?.getTime() ?? 0;
    return tb - ta;
  });
  return all;
}

function getActiveUrls() {
  return feedUrls.length > 0 ? feedUrls : [...DEFAULT_NEWS_FEED_URLS];
}

async function searchFeeds(query, page) {
  const urls = getActiveUrls();
  if (urls.length === 0) return [];
  const allItems = await fetchAllFeeds(urls);
  const q = query.trim().toLowerCase();
  const filtered =
    q === ""
      ? allItems
      : allItems.filter((item) => {
          const title = item.title.toLowerCase();
          const desc = item.description.toLowerCase();
          return title.includes(q) || desc.includes(q);
        });
  const start = (page - 1) * PAGE_SIZE;
  return filtered.slice(start, start + PAGE_SIZE);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(date) {
  if (!date) return "";
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function cleanUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

function faviconUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return `/api/proxy/image?url=${encodeURIComponent(`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`)}`;
  } catch {
    return "";
  }
}

function proxyImageUrl(url) {
  if (!url) return "";
  return `/api/proxy/image?url=${encodeURIComponent(url)}`;
}

function renderResultsHtml(items, page, query) {
  if (items.length === 0) {
    return `<div class="command-result"><p>No RSS results found${query ? ` for <strong>${escapeHtml(query)}</strong>` : ""}.</p></div>`;
  }
  let html = "";
  for (const item of items) {
    const dateStr = formatDate(item.pubDate);
    const thumbBlock = item.thumbnail
      ? `<div class="result-thumbnail-wrap"><img class="result-thumbnail-img" src="${escapeHtml(proxyImageUrl(item.thumbnail))}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`
      : "";
    const body = `
      <div class="result-url-row">
        <img class="result-favicon" src="${faviconUrl(item.url)}" alt="" width="26" height="26" onerror="this.style.display='none'">
        <cite class="result-cite">${escapeHtml(cleanUrl(item.url))}</cite>
      </div>
      <a class="result-title" href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.title)}</a>
      <p class="result-snippet">${escapeHtml(item.description.slice(0, 200))}</p>
      <div class="result-engines"><span class="result-engine-tag">${escapeHtml(item.source)}</span>${dateStr ? `<span class="rss-result-date">${escapeHtml(dateStr)}</span>` : ""}</div>`;
    if (thumbBlock) {
      html += `<div class="result-item"><div class="result-item-inner"><div class="result-body">${body}</div>${thumbBlock}</div></div>`;
    } else {
      html += `<div class="result-item">${body}</div>`;
    }
  }
  return html;
}

const command = {
  name: "Home RSS Feeds",
  description: "RSS/Atom news feed reader with home page integration",
  trigger: "rss",
  aliases: ["news", "feed"],
  naturalLanguagePhrases: ["latest news", "news feed", "rss feed"],

  defaultFeedUrls: DEFAULT_NEWS_FEED_URLS,

  settingsSchema: [
    {
      key: "urls",
      label: "Feed URLs",
      type: "urllist",
      description:
        "Manage your RSS/Atom feed URLs. Remove individual feeds or add new ones below.",
      placeholder: "https://example.com/feed.xml",
    },
    {
      key: "showOnDesktop",
      label: "Show news on desktop",
      type: "toggle",
      description:
        "Display the news feed on the home page on desktop too (horizontal scrolling).",
    },
  ],

  configure(settings) {
    const urlsVal = settings.urls;
    let parsed = [];
    if (Array.isArray(urlsVal)) {
      parsed = urlsVal.filter((u) => typeof u === "string" && u.startsWith("http"));
    } else if (typeof urlsVal === "string" && urlsVal.trim()) {
      try {
        const json = JSON.parse(urlsVal);
        if (Array.isArray(json)) {
          parsed = json.filter((u) => typeof u === "string" && u.startsWith("http"));
        }
      } catch {
        parsed = urlsVal
          .split("\n")
          .map((u) => u.trim())
          .filter((u) => {
            try {
              return u.startsWith("http") && !!new URL(u);
            } catch {
              return false;
            }
          });
      }
    }
    feedUrls = parsed;
    showOnDesktop =
      settings.showOnDesktop === true || settings.showOnDesktop === "true";
  },

  async execute(args, context) {
    const page = context?.page ?? 1;
    const query = args.trim();
    const items = await searchFeeds(query, page);
    const totalItems = await (async () => {
      const urls = getActiveUrls();
      const allItems = await fetchAllFeeds(urls);
      const q = query.toLowerCase();
      return q
        ? allItems.filter(
            (i) =>
              i.title.toLowerCase().includes(q) ||
              i.description.toLowerCase().includes(q),
          ).length
        : allItems.length;
    })();
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    return {
      title: query
        ? `RSS Feeds - "${query}"`
        : "RSS Feeds - Latest",
      html: renderResultsHtml(items, page, query),
      totalPages: totalPages > 1 ? totalPages : undefined,
    };
  },
};

const routes = [
  {
    method: "get",
    path: "/feed",
    handler: async (req) => {
      const url = new URL(req.url);
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const items = await searchFeeds("", page);
      const results = items.map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.description,
        source: item.source,
        thumbnail: item.thumbnail,
        pubDate: item.pubDate ? item.pubDate.toISOString() : null,
      }));
      return new Response(
        JSON.stringify({ results, showOnDesktop }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  },
];

module.exports = command;
module.exports.routes = routes;
module.exports.default = command;
