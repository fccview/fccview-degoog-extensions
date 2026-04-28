export const outgoingHosts = ["commons.wikimedia.org"];
export const type = "images";

const API_URL = "https://commons.wikimedia.org/w/api.php";
const PAGE_SIZE = 20;

const _stripHtml = (value) => {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]+>/g, "").trim();
};

const _extractSnippet = (extmetadata) => {
  if (!extmetadata) return "";
  const desc = _stripHtml(extmetadata.ImageDescription?.value ?? "");
  const artist = _stripHtml(extmetadata.Artist?.value ?? "");
  const license = extmetadata.LicenseShortName?.value ?? "";
  const parts = [];
  if (desc) parts.push(desc);
  if (artist) parts.push(`By ${artist}`);
  if (license) parts.push(license);
  return parts.join(" — ");
};

export default class WikimediaCommonsEngine {
  name = "Wikimedia Commons";
  bangShortcut = "wikimedia";

  executeSearch = async (query, page = 1, _timeFilter, context) => {
    const doFetch = context?.fetch ?? fetch;
    const offset = (Math.max(1, page || 1) - 1) * PAGE_SIZE;

    const params = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "search",
      gsrnamespace: "6",
      gsrsearch: query,
      gsrlimit: String(PAGE_SIZE),
      gsroffset: String(offset),
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "400",
      origin: "*",
    });

    try {
      const response = await doFetch(`${API_URL}?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Degoog/1.0 (https://github.com/fccview/degoog)",
          "Accept-Language": context?.buildAcceptLanguage?.() ?? "en,en-US;q=0.9",
        },
      });

      if (!response.ok) return [];

      const data = await response.json();
      const pages = data?.query?.pages;
      if (!pages) return [];

      const items = Object.values(pages);
      items.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

      return items
        .map((p) => {
          const info = Array.isArray(p.imageinfo) ? p.imageinfo[0] : null;
          if (!info) return null;
          const thumb = info.thumburl ?? info.url ?? "";
          const fullUrl = info.url ?? "";
          const pageUrl = info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title ?? "")}`;
          const title = (p.title ?? "").replace(/^File:/, "");
          return {
            title,
            url: pageUrl,
            snippet: _extractSnippet(info.extmetadata) || title,
            source: this.name,
            thumbnail: thumb,
            imageUrl: fullUrl,
          };
        })
        .filter((r) => r && r.thumbnail && r.url);
    } catch {
      return [];
    }
  };
}
