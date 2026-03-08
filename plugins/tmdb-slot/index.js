let apiKey = "";
let template = "";

const IMAGE_BASE = "https://image.tmdb.org/t/p";
const POSTER_SIZE = "w185";
const PROFILE_SIZE = "w185";

function esc(s) {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function imgUrl(path, size) {
  if (!path || typeof path !== "string") return "";
  const p = path.trim();
  if (!p) return "";
  return `${IMAGE_BASE}/${size}${p.startsWith("/") ? p : "/" + p}`;
}

function render(data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? "");
}

async function tmdb(key, path) {
  const base = "https://api.themoviedb.org/3";
  const sep = path.includes("?") ? "&" : "?";
  const full = `${base}/${path}${sep}api_key=${encodeURIComponent(key)}&language=en-US`;
  const res = await fetch(full);
  if (!res.ok) return null;
  return res.json();
}

function parseQuery(query) {
  const q = query.trim();
  const castMatch = q.match(/^(.+?)\s+cast\s*$/i);
  if (castMatch) {
    return { intent: "cast", term: (castMatch[1] || q.replace(/\s+cast\s*$/i, "")).trim() };
  }
  return { intent: "search", term: q };
}

function buildCastStrip(cast, key) {
  if (!Array.isArray(cast) || cast.length === 0) return "";
  return cast
    .slice(0, 24)
    .map((c) => {
      const name = esc(c.name || "");
      const character = c.character ? esc(c.character) : "";
      const photoUrl = imgUrl(c.profile_path, PROFILE_SIZE);
      const img = photoUrl
        ? `<img src="${esc(photoUrl)}" alt="" loading="lazy" class="imdb-cast-photo" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">`
        : "";
      const initial = (c.name || "").trim().charAt(0).toUpperCase();
      const fallback = `<span class="imdb-cast-initial" style="${img ? "display:none" : ""}">${esc(initial)}</span>`;
      return `<div class="imdb-cast-card"><div class="imdb-cast-photo-wrap">${img}${fallback}</div><span class="imdb-cast-name">${name}</span>${character ? `<span class="imdb-cast-character">${character}</span>` : ""}</div>`;
    })
    .join("");
}

function buildMovieCards(movies, key) {
  if (!Array.isArray(movies) || movies.length === 0) return "";
  return movies
    .slice(0, 30)
    .map((m) => {
      const title = esc(m.title || m.name || "");
      const year = (m.release_date || m.first_air_date || "").slice(0, 4);
      const posterUrl = imgUrl(m.poster_path, POSTER_SIZE);
      const posterHtml = posterUrl
        ? `<img src="${esc(posterUrl)}" alt="" loading="lazy" class="imdb-movie-poster-img">`
        : `<span class="imdb-movie-poster-placeholder">${(title || "?").charAt(0)}</span>`;
      return `<a href="https://www.themoviedb.org/${m.media_type || "movie"}/${m.id}" target="_blank" rel="noopener" class="imdb-movie-card"><div class="imdb-movie-poster">${posterHtml}</div><span class="imdb-movie-title">${title}</span><span class="imdb-movie-year">${year}</span></a>`;
    })
    .join("");
}

export const slot = {
  id: "tmdb",
  name: "TMDb",
  position: "above-results",
  description: "Shows movie/TV show details above search results.",

  settingsSchema: [
    {
      key: "apiKey",
      label: "API Key",
      type: "password",
      required: true,
      secret: true,
      placeholder: "Free at themoviedb.org",
      description: "Key is needed in order to get cast photos, filmography, movie/TV search. Get one at https://www.themoviedb.org/settings/api",
    },
  ],

  init(ctx) {
    template = ctx.template;
  },

  configure(settings) {
    const raw = (settings && settings.apiKey) || "";
    apiKey = typeof raw === "string" ? raw.trim() : "";
  },

  trigger(query) {
    const q = query.trim();
    return q.length >= 2 && q.length <= 80;
  },

  async execute(query) {
    if (!apiKey) return { title: "", html: "" };

    const { intent, term } = parseQuery(query);
    if (!term) return { title: "", html: "" };

    try {
      if (intent === "cast") {
        const multi = await tmdb(apiKey, `search/multi?query=${encodeURIComponent(term)}`);
        const results = multi?.results || [];
        const item = results.find((r) => r.media_type === "movie" || r.media_type === "tv") || results[0];
        if (!item || !item.id) return { title: "", html: "" };
        const mediaType = item.media_type || "movie";
        const cred = await tmdb(apiKey, `${mediaType}/${item.id}/credits`);
        const cast = cred?.cast || [];
        const title = item.title || item.name || "";
        const year = (item.release_date || item.first_air_date || "").slice(0, 4);
        const typeLabel = mediaType === "tv" ? "TV Series" : "Movie";
        const posterUrl = imgUrl(item.poster_path, POSTER_SIZE);
        const posterHtml = posterUrl
          ? `<div class="imdb-poster"><img src="${esc(posterUrl)}" alt="" loading="lazy"></div>`
          : "";
        const metaLine = [typeLabel, year].filter(Boolean).join(" · ");
        const castStrip = buildCastStrip(cast);
        const castSection = castStrip
          ? `<h4 class="imdb-cast-heading">Cast</h4><div class="imdb-cast-scroll"><div class="imdb-cast-strip">${castStrip}</div></div>`
          : "";
        const content = `<div class="imdb-hero imdb-hero--compact">${posterHtml}<div class="imdb-hero-text"><div class="imdb-meta">${esc(metaLine)}</div><h3 class="imdb-title">${esc(title)}</h3></div></div>${castSection}`;
        return { title: "Cast", html: render({ content }) };
      }

      const personRes = await tmdb(apiKey, `search/person?query=${encodeURIComponent(term)}`);
      const personResults = personRes?.results || [];
      const person = personResults[0];
      if (person && person.id) {
        const nameLower = (person.name || "").toLowerCase();
        const termLower = term.toLowerCase();
        const termWords = termLower.split(/\s+/).filter(Boolean);
        const nameWords = nameLower.split(/\s+/).filter(Boolean);
        const match = termWords.length >= 1 && termWords.length <= 4 && termWords.every((w) => nameWords.some((nw) => nw.startsWith(w) || nw.includes(w)));
        if (match) {
          const [movieCredits, tvCredits] = await Promise.all([
            tmdb(apiKey, `person/${person.id}/movie_credits`),
            tmdb(apiKey, `person/${person.id}/tv_credits`),
          ]);
          const movieCast = movieCredits?.cast || [];
          const tvCast = tvCredits?.cast || [];
          const movies = movieCast
            .map((c) => ({ ...c, media_type: "movie", release_date: c.release_date }))
            .filter((c) => c.title && c.release_date)
            .sort((a, b) => (b.release_date || "").localeCompare(a.release_date || ""));
          const tvShows = tvCast
            .map((c) => ({ ...c, media_type: "tv", first_air_date: c.first_air_date }))
            .filter((c) => c.name && (c.first_air_date || c.release_date))
            .sort((a, b) => (b.first_air_date || b.release_date || "").localeCompare(a.first_air_date || a.release_date || ""));
          const filmography = [...movies, ...tvShows].slice(0, 30);
          const movieCards = buildMovieCards(filmography);
          const sectionTitle = "Filmography";
          const content = `<h3 class="imdb-filmography-title">${esc(person.name || term)}</h3><h4 class="imdb-section-heading">${sectionTitle}</h4><div class="imdb-filmography-scroll"><div class="imdb-filmography-strip">${movieCards}</div></div>`;
          return { title: person.name || "Filmography", html: render({ content }) };
        }
      }

      const multi = await tmdb(apiKey, `search/multi?query=${encodeURIComponent(term)}`);
      const results = multi?.results || [];
      const item = results.find((r) => r.media_type === "movie" || r.media_type === "tv") || results[0];
      if (!item || !item.id) return { title: "", html: "" };
      const mediaType = item.media_type || "movie";
      const details = await tmdb(apiKey, `${mediaType}/${item.id}`);
      const cred = await tmdb(apiKey, `${mediaType}/${item.id}/credits`);
      const cast = cred?.cast || [];
      const title = item.title || item.name || details?.title || details?.name || "";
      const year = (item.release_date || item.first_air_date || details?.release_date || details?.first_air_date || "").slice(0, 4);
      const typeLabel = mediaType === "tv" ? "TV Series" : "Movie";
      const plot = details?.overview || "";
      const posterUrl = imgUrl(item.poster_path || details?.poster_path, POSTER_SIZE);
      const posterHtml = posterUrl
        ? `<div class="imdb-poster"><img src="${esc(posterUrl)}" alt="" loading="lazy"></div>`
        : "";
      const metaParts = [typeLabel, year].filter(Boolean);
      const metaLine = metaParts.join(" · ");
      const castStrip = buildCastStrip(cast);
      const castSection = castStrip
        ? `<h4 class="imdb-cast-heading">Cast</h4><div class="imdb-cast-scroll"><div class="imdb-cast-strip">${castStrip}</div></div>`
        : "";
      const plotBlock = plot ? `<p class="imdb-plot">${esc(plot)}</p>` : "";
      const linkUrl = `https://www.themoviedb.org/${mediaType}/${item.id}`;
      const content = `<div class="imdb-hero">${posterHtml}<div class="imdb-hero-text"><div class="imdb-meta">${esc(metaLine)}</div><h3 class="imdb-title">${esc(title)}</h3></div></div>${plotBlock}${castSection}${linkBlock}`;
      return { title: title || "Movie", html: render({ content }) };
    } catch {
      return { title: "", html: "" };
    }
  },
};

export default { slot };
