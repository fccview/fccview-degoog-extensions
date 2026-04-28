export const outgoingHosts = ["api.openverse.org"];
export const type = "images";

const API_URL = "https://api.openverse.org/v1/images/";
const PAGE_SIZE = 20;

export default class OpenverseEngine {
  name = "Openverse";
  bangShortcut = "openverse";

  executeSearch = async (query, page = 1, _timeFilter, context) => {
    const doFetch = context?.fetch ?? fetch;
    const params = new URLSearchParams({
      q: query,
      page: String(Math.max(1, page || 1)),
      page_size: String(PAGE_SIZE),
    });

    try {
      const response = await doFetch(`${API_URL}?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          "Accept-Language": context?.buildAcceptLanguage?.() ?? "en,en-US;q=0.9",
        },
      });

      if (!response.ok) return [];

      const data = await response.json();
      const items = data?.results ?? [];

      return items
        .map((item) => ({
          title: item.title ?? "",
          url: item.foreign_landing_url ?? item.url ?? "",
          snippet: item.creator ? `By ${item.creator}${item.license ? ` — ${item.license}` : ""}` : (item.license ?? ""),
          source: this.name,
          thumbnail: item.thumbnail ?? item.url ?? "",
          imageUrl: item.url ?? item.thumbnail ?? "",
        }))
        .filter((r) => r.url && r.thumbnail);
    } catch {
      return [];
    }
  };
}
