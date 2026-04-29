let apiKey = "";
let template = "";

const IMAGE_BASE = "https://image.tmdb.org/t/p";
const POSTER_SIZE = "w185";
const PROFILE_SIZE = "w185";
const MAX_TABS = 5;

const MEDIA_KEYWORDS =
  /\b(movie|film|show|series|cast|actor|actress|director|season|episode|trailer|anime|manga|tv|imdb|tmdb|netflix|hulu|streaming|watch|rating|review|screenplay|box\s?office|filmography|remake|sequel|prequel|dubbed|subbed|ost|soundtrack)\b/i;

const CAST_PATTERN = /^(.+?)\s+cast\s*$/i;

const NON_MEDIA_PATTERN =
  /^(how\s|what\s(is|are|does|do)\s(a|an|the)?\s?(best\s)?(way|method|difference|meaning|purpose|reason)|why\s|where\s(can|do|is)|when\s(did|does|is|was)|can\si|should\si|how\sto|define\s|weather|recipe|price\sof|buy\s|download\s|install\s|code\s|error\s|fix\s|debug\s|www\.|https?:)/i;

const _hasMediaIntent = (query) => {
  if (MEDIA_KEYWORDS.test(query)) return true;
  if (CAST_PATTERN.test(query)) return true;

  return false;
};

const _titleSimilarity = (query, title) => {
  const q = query.toLowerCase().trim();
  const t = (title || "").toLowerCase().trim();
  if (!t) return 0;
  if (t === q) return 1;
  if (t.startsWith(q) || q.startsWith(t)) return 0.9;
  const qWords = q.split(/\s+/);
  const tWords = t.split(/\s+/);
  const matches = qWords.filter((w) => tWords.includes(w)).length;

  return matches / Math.max(qWords.length, tWords.length);
};

const _isConfidentMatch = (query, result, mediaIntent) => {
  if (!result) return false;

  const sim = _titleSimilarity(query, result.title || result.name);
  const pop = result.popularity || 0;

  if (sim >= 1 && pop >= 5) return true;
  if (sim >= 0.9 && pop >= 15) return true;
  if (sim >= 0.7 && pop >= 40) return true;
  if (mediaIntent && sim >= 0.9) return true;
  if (mediaIntent && sim >= 0.7 && pop >= 10) return true;

  return false;
};

const _stripMediaKeywords = (query) => {
  return query
    .replace(MEDIA_KEYWORDS, "")
    .replace(/\s{2,}/g, " ")
    .trim();
};

const _esc = (s) => {
  if (typeof s !== "string") return "";
  
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const _imgUrl = (path, size) => {
  if (!path || typeof path !== "string") return "";

  const p = path.trim();

  if (!p) return "";

  return `${IMAGE_BASE}/${size}${p.startsWith("/") ? p : "/" + p}`;
};

const _render = (data) => {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? "");
};  

const _tmdb = async (key, path, fetchFn = fetch) => {
  const base = "https://api.themoviedb.org/3";
  const sep = path.includes("?") ? "&" : "?";
  const full = `${base}/${path}${sep}api_key=${encodeURIComponent(key)}&language=en-US`;
  const res = await fetchFn(full);

  if (!res.ok) return null;

  return res.json();
};

const _parseQuery = (query) => {
  const q = query.trim();
  const castMatch = q.match(CAST_PATTERN);

  if (castMatch) {
    return { intent: "cast", term: castMatch[1].trim() };
  }

  return { intent: "search", term: q };
};

const _buildCastStrip = (cast) => {
  if (!Array.isArray(cast) || cast.length === 0) return "";
  return cast
    .slice(0, 24)
    .map((c) => {
      const name = _esc(c.name || "");
      const character = c.character ? _esc(c.character) : "";
      const photoUrl = _imgUrl(c.profile_path, PROFILE_SIZE);
      const img = photoUrl
        ? `<img src="${_esc(photoUrl)}" alt="" loading="lazy" class="imdb-cast-photo" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : "";
      const initial = (c.name || "").trim().charAt(0).toUpperCase();
      const fallback = `<span class="imdb-cast-initial" style="${img ? "display:none" : ""}">${_esc(initial)}</span>`;
      const href = c.id ? `https://www.themoviedb.org/person/${c.id}` : "";
      const inner = `<div class="imdb-cast-photo-wrap">${img}${fallback}</div><span class="imdb-cast-name">${name}</span>${character ? `<span class="imdb-cast-character">${character}</span>` : ""}`;
      return href
        ? `<a href="${_esc(href)}" target="_blank" rel="noopener" class="imdb-cast-card">${inner}</a>`
        : `<div class="imdb-cast-card">${inner}</div>`;
    })
    .join("");
};

const _buildMovieCards = (movies) => {
  if (!Array.isArray(movies) || movies.length === 0) return "";
  return movies
    .slice(0, 30)
    .map((m) => {
      const title = _esc(m.title || m.name || "");
      const year = (m.release_date || m.first_air_date || "").slice(0, 4);
      const posterUrl = _imgUrl(m.poster_path, POSTER_SIZE);
      const posterHtml = posterUrl
        ? `<img src="${_esc(posterUrl)}" alt="" loading="lazy" class="imdb-movie-poster-img">`
        : `<span class="imdb-movie-poster-placeholder">${(title || "?").charAt(0)}</span>`;
      return `<a href="https://www.themoviedb.org/${m.media_type || "movie"}/${m.id}" target="_blank" rel="noopener" class="imdb-movie-card"><div class="imdb-movie-poster">${posterHtml}</div><span class="imdb-movie-title">${title}</span><span class="imdb-movie-year">${year}</span></a>`;
    })
    .join("");
};

const _tabLabel = (item, mediaType) => {
  const title = item.title || item.name || "";
  const year = (item.release_date || item.first_air_date || "").slice(0, 4);
  const type = mediaType === "tv" ? "TV" : "Movie";
  return year ? `${title} (${type}, ${year})` : `${title} (${type})`;
};

const _buildSeasonAccordion = (season, tmdbId) => {
  const name = _esc(season.name || `Season ${season.season_number}`);
  const epCount = season.episode_count || 0;
  const airYear = (season.air_date || "").slice(0, 4);
  const overview = season.overview ? _esc(season.overview) : "";
  const posterUrl = _imgUrl(season.poster_path, "w92");
  const posterHtml = posterUrl
    ? `<img src="${_esc(posterUrl)}" alt="" loading="lazy" class="tmdb-season-poster">`
    : "";
  const meta = [airYear, `${epCount} episode${epCount !== 1 ? "s" : ""}`]
    .filter(Boolean)
    .join(" · ");
  const link = `https://www.themoviedb.org/tv/${tmdbId}/season/${season.season_number}`;

  return `<details class="tmdb-accordion"><summary class="tmdb-accordion-summary">${name}<span class="tmdb-accordion-meta">${_esc(meta)}</span></summary><div class="tmdb-accordion-body"><div class="tmdb-season-detail">${posterHtml}<div class="tmdb-season-info">${overview ? `<p class="tmdb-season-overview">${overview}</p>` : ""}<a href="${_esc(link)}" target="_blank" rel="noopener" class="tmdb-season-link">View episodes</a></div></div></div></details>`;
};

const _buildSeasonsSection = (details, tmdbId) => {
  const seasons = details?.seasons;

  if (!Array.isArray(seasons) || seasons.length === 0) return "";

  const seasonHtml = seasons
    .filter((s) => s.season_number > 0)
    .map((s) => _buildSeasonAccordion(s, tmdbId))
    .join("");
  if (!seasonHtml) return "";

  return `<details class="tmdb-accordion"><summary class="tmdb-accordion-summary">Seasons<span class="tmdb-accordion-meta">${seasons.filter((s) => s.season_number > 0).length} seasons</span></summary><div class="tmdb-accordion-body">${seasonHtml}</div></details>`;
};

const _buildItemPanel = (item, details, cast, mediaType) => {
  const title = item.title || item.name || details?.title || details?.name || "";
  const year = (
    item.release_date ||
    item.first_air_date ||
    details?.release_date ||
    details?.first_air_date ||
    ""
  ).slice(0, 4);
  const typeLabel = mediaType === "tv" ? "TV Series" : "Movie";
  const plot = details?.overview || "";
  const posterUrl = _imgUrl(item.poster_path || details?.poster_path, POSTER_SIZE);
  const posterHtml = posterUrl
    ? `<div class="imdb-poster"><img src="${_esc(posterUrl)}" alt="" loading="lazy"></div>`
    : "";
  const metaLine = [typeLabel, year].filter(Boolean).join(" · ");
  const castStrip = _buildCastStrip(cast);
  const castSection = castStrip
      ? `<details class="tmdb-accordion" open><summary class="tmdb-accordion-summary">Cast<span class="tmdb-accordion-meta">${cast.length} ${cast.length === 1 ? "person" : "people"}</span></summary><div class="tmdb-accordion-body"><div class="imdb-cast-scroll"><div class="imdb-cast-strip">${castStrip}</div></div></div></details>`
    : "";
  const seasonsSection = mediaType === "tv" ? _buildSeasonsSection(details, item.id) : "";
  const plotBlock = plot ? `<p class="imdb-plot">${_esc(plot)}</p>` : "";
  const tmdbHref = item.id ? `https://www.themoviedb.org/${mediaType}/${item.id}` : "";
  const titleHtml = tmdbHref
    ? `<a href="${_esc(tmdbHref)}" target="_blank" rel="noopener" class="imdb-title-link"><h3 class="imdb-title">${_esc(title)}</h3></a>`
    : `<h3 class="imdb-title">${_esc(title)}</h3>`;

  return `<div class="imdb-hero">${posterHtml}<div class="imdb-hero-text"><div class="imdb-meta">${_esc(metaLine)}</div>${titleHtml}</div></div>${plotBlock}${castSection}${seasonsSection}`;
};

const _wrapTabs = (tabs) => {
  if (tabs.length === 1) return tabs[0].panel;
  
  const tabButtons = tabs
    .map(
      (t, i) =>
        `<button class="tmdb-tab-btn${i === 0 ? " tmdb-tab-btn--active" : ""}" data-tmdb-tab="${i}" onclick="this.parentElement.querySelectorAll('.tmdb-tab-btn').forEach(b=>b.classList.remove('tmdb-tab-btn--active'));this.classList.add('tmdb-tab-btn--active');this.closest('.tmdb-tabs').querySelectorAll('.tmdb-tab-panel').forEach((p,j)=>{p.style.display=j===${i}?'block':'none'})">${_esc(t.label)}</button>`,
    )
    .join("");

  const tabPanels = tabs
    .map(
      (t, i) =>
        `<div class="tmdb-tab-panel" style="${i === 0 ? "" : "display:none"}">${t.panel}</div>`,
    )
    .join("");

  return `<div class="tmdb-tabs"><div class="tmdb-tab-bar">${tabButtons}</div>${tabPanels}</div>`;
};

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
      description:
        "Key is needed in order to get cast photos, filmography, movie/TV search. Get one at https://www.themoviedb.org/settings/api",
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
    if (q.length < 2 || q.length > 80) return false;
    if (NON_MEDIA_PATTERN.test(q)) return false;
    return true;
  },

  async execute(query, context) {
    if (!apiKey) return { title: "", html: "" };

    const fetchFn = context?.fetch || fetch;
    const { intent, term } = _parseQuery(query);
    if (!term) return { title: "", html: "" };

    const searchTerm = _stripMediaKeywords(term) || term;
    const mediaIntent = _hasMediaIntent(query);

    try {
      const multi = await _tmdb(apiKey, `search/multi?query=${encodeURIComponent(searchTerm)}`, fetchFn);
      const allResults = multi?.results || [];

      if (intent === "cast") {
        const item =
          allResults.find((r) => r.media_type === "movie" || r.media_type === "tv") ||
          allResults[0];
        if (!item || !item.id) return { title: "", html: "" };
        const mediaType = item.media_type || "movie";
        const cred = await _tmdb(apiKey, `${mediaType}/${item.id}/credits`, fetchFn);
        const cast = cred?.cast || [];
        const title = item.title || item.name || "";
        const year = (item.release_date || item.first_air_date || "").slice(0, 4);
        const typeLabel = mediaType === "tv" ? "TV Series" : "Movie";
        const posterUrl = _imgUrl(item.poster_path, POSTER_SIZE);
        const posterHtml = posterUrl
          ? `<div class="imdb-poster"><img src="${_esc(posterUrl)}" alt="" loading="lazy"></div>`
          : "";
        const metaLine = [typeLabel, year].filter(Boolean).join(" · ");
        const castStrip = _buildCastStrip(cast);
        const castSection = castStrip
          ? `<h4 class="imdb-cast-heading">Cast</h4><div class="imdb-cast-scroll"><div class="imdb-cast-strip">${castStrip}</div></div>`
          : "";
        const tmdbHref = item.id ? `https://www.themoviedb.org/${mediaType}/${item.id}` : "";
        const titleHtml = tmdbHref
          ? `<a href="${_esc(tmdbHref)}" target="_blank" rel="noopener" class="imdb-title-link"><h3 class="imdb-title">${_esc(title)}</h3></a>`
          : `<h3 class="imdb-title">${_esc(title)}</h3>`;
        const content = `<div class="imdb-hero imdb-hero--compact">${posterHtml}<div class="imdb-hero-text"><div class="imdb-meta">${_esc(metaLine)}</div>${titleHtml}</div></div>${castSection}`;
        return { title: "Cast", html: _render({ content }) };
      }

      const person = allResults.find((r) => r.media_type === "person");
      if (person && person.id && _isConfidentMatch(searchTerm, person, mediaIntent)) {
        const [movieCredits, tvCredits] = await Promise.all([
          _tmdb(apiKey, `person/${person.id}/movie_credits`, fetchFn),
          _tmdb(apiKey, `person/${person.id}/tv_credits`, fetchFn),
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
          .sort((a, b) =>
            (b.first_air_date || b.release_date || "").localeCompare(
              a.first_air_date || a.release_date || "",
            ),
          );
        const filmography = [...movies, ...tvShows].slice(0, 30);
        if (filmography.length > 0) {
          const movieCards = _buildMovieCards(filmography);
          const personHref = `https://www.themoviedb.org/person/${person.id}`;
          const personTitleHtml = `<a href="${_esc(personHref)}" target="_blank" rel="noopener" class="imdb-title-link"><h3 class="imdb-filmography-title">${_esc(person.name || searchTerm)}</h3></a>`;
          const content = `${personTitleHtml}<h4 class="imdb-section-heading">Filmography</h4><div class="imdb-filmography-scroll"><div class="imdb-filmography-strip">${movieCards}</div></div>`;
          return { title: person.name || "Filmography", html: _render({ content }) };
        }
      }

      const mediaResults = allResults.filter(
        (r) => r.media_type === "movie" || r.media_type === "tv",
      );
      const matches = mediaResults
        .filter((r) => _isConfidentMatch(searchTerm, r, mediaIntent))
        .slice(0, MAX_TABS);
      if (matches.length === 0) return { title: "", html: "" };

      const seen = new Set();
      const unique = matches.filter((m) => {
        const key = `${m.media_type}-${m.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const enriched = await Promise.all(
        unique.map(async (item) => {
          const mediaType = item.media_type || "movie";
          const [details, cred] = await Promise.all([
            _tmdb(apiKey, `${mediaType}/${item.id}`, fetchFn),
            _tmdb(apiKey, `${mediaType}/${item.id}/credits`, fetchFn),
          ]);
          return { item, details, cast: cred?.cast || [], mediaType };
        }),
      );

      const tabs = enriched.map((e) => ({
        label: _tabLabel(e.item, e.mediaType),
        panel: _buildItemPanel(e.item, e.details, e.cast, e.mediaType),
      }));

      const firstTitle =
        enriched[0].item.title ||
        enriched[0].item.name ||
        enriched[0].details?.title ||
        enriched[0].details?.name ||
        "";
      const content = _wrapTabs(tabs);
      return { title: firstTitle || "Movie", html: _render({ content }) };
    } catch {
      return { title: "", html: "" };
    }
  },
};

export default { slot };
