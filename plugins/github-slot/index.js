const GITHUB_HOST = "github.com";
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

const RESERVED_SEGMENTS = new Set([
  "orgs", "blog", "explore", "settings", "login", "search", "about", "topics",
  "collections", "enterprise", "pricing", "contact", "features", "notifications",
  "new", "repository", "repos", "codespaces", "sponsors", "marketplace",
  "customer-stories", "team", "terms", "privacy", "security", "site", "mobile",
  "top", "trending", "organizations", "repositories", "stars",
]);

const apiCache = new Map();
const cacheExpiry = new Map();

let apiToken = "";
let maxRepos = 3;
let maxUsers = 2;
let template = "";

const _cacheGet = (key) => {
  const expiresAt = cacheExpiry.get(key);
  if (expiresAt == null || Date.now() > expiresAt) {
    apiCache.delete(key);
    cacheExpiry.delete(key);
    return null;
  }
  return apiCache.get(key) ?? null;
};

const _cacheSet = (key, value) => {
  if (apiCache.size >= CACHE_MAX_ENTRIES) {
    let oldestKey = null;
    let oldestExpiry = Infinity;
    for (const [k, exp] of cacheExpiry) {
      if (exp < oldestExpiry) {
        oldestExpiry = exp;
        oldestKey = k;
      }
    }
    if (oldestKey != null) {
      apiCache.delete(oldestKey);
      cacheExpiry.delete(oldestKey);
    }
  }
  apiCache.set(key, value);
  cacheExpiry.set(key, Date.now() + CACHE_TTL_MS);
};

const _esc = (s) => {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const _parseGitHubUrls = (results) => {
  const repos = new Map();
  const users = new Map();
  if (!Array.isArray(results)) return { repos: [], users: [] };

  for (const r of results) {
    const url = (r && r.url) ? String(r.url).trim() : "";
    if (!url) continue;
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "");
      if (host !== GITHUB_HOST) continue;
      const segments = u.pathname.split("/").filter(Boolean);
      if (segments.length === 1) {
        const login = segments[0];
        if (!RESERVED_SEGMENTS.has(login.toLowerCase())) users.set(login.toLowerCase(), login);
      } else if (segments.length >= 2) {
        const owner = segments[0];
        const repo = segments[1].replace(/\/.*$/, "");
        if (RESERVED_SEGMENTS.has(owner.toLowerCase())) continue;
        const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
        repos.set(key, { owner: segments[0], repo });
      }
    } catch {
      //
    }
  }

  return {
    repos: Array.from(repos.values()).slice(0, maxRepos),
    users: Array.from(users.values()).slice(0, maxUsers),
  };
};

const _getHeaders = () => {
  const headers = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "degoog-github-slot/1.0",
  };
  if (apiToken) headers.Authorization = `Bearer ${apiToken}`;
  return headers;
};

const _fetchRepo = async (owner, repo) => {
  const key = `repo:${String(owner).toLowerCase()}/${String(repo).toLowerCase()}`;
  const cached = _cacheGet(key);
  if (cached != null) return cached;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const res = await fetch(url, { headers: _getHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  _cacheSet(key, data);
  return data;
};

const _fetchUser = async (login) => {
  const key = `user:${String(login).toLowerCase()}`;
  const cached = _cacheGet(key);
  if (cached != null) return cached;
  const url = `https://api.github.com/users/${encodeURIComponent(login)}`;
  const res = await fetch(url, { headers: _getHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  _cacheSet(key, data);
  return data;
};

const _render = (data) => {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? "");
};

const _formatCount = (n) => {
  if (n == null || !Number.isFinite(n)) return "0";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

export const slot = {
  id: "github-slot",
  name: "GitHub",
  position: "above-results",
  description: "When search results include GitHub repos or users, shows styled info above results.",

  settingsSchema: [
    {
      key: "apiToken",
      label: "GitHub API token",
      type: "password",
      secret: true,
      placeholder: "Optional, for higher rate limit",
      description: "Personal access token (optional). Without it, API is limited to 60 requests/hour.",
    },
    {
      key: "maxRepos",
      label: "Max repos to show",
      type: "text",
      placeholder: "3",
      description: "Maximum number of repo cards to display (1–5).",
    },
    {
      key: "maxUsers",
      label: "Max users to show",
      type: "text",
      placeholder: "2",
      description: "Maximum number of user cards to display (1–3).",
    },
  ],

  init(ctx) {
    template = ctx.template;
  },

  configure(settings) {
    apiToken = (settings && settings.apiToken) ? String(settings.apiToken).trim() : "";
    const r = parseInt(settings?.maxRepos ?? "3", 10);
    maxRepos = Number.isFinite(r) ? Math.max(1, Math.min(5, r)) : 3;
    const u = parseInt(settings?.maxUsers ?? "2", 10);
    maxUsers = Number.isFinite(u) ? Math.max(1, Math.min(3, u)) : 2;
  },

  trigger() {
    return true;
  },

  async execute(_query, context) {
    const results = context?.results ?? [];
    const { repos, users } = _parseGitHubUrls(results);
    if (repos.length === 0 && users.length === 0) return { title: "", html: "" };

    const repoCards = [];
    const userCards = [];

    for (const { owner, repo } of repos) {
      const data = await _fetchRepo(owner, repo);
      if (!data) continue;
      const fullName = _esc(data.full_name || `${owner}/${repo}`);
      const desc = _esc((data.description || "").slice(0, 160));
      const stars = _formatCount(data.stargazers_count);
      const lang = _esc(data.language || "");
      const href = _esc(data.html_url || `https://github.com/${owner}/${repo}`);
      const avatarUrl = data.owner && data.owner.avatar_url ? _esc(data.owner.avatar_url) : "";
      const avatarHtml = avatarUrl
        ? `<img src="${avatarUrl}" alt="" class="gh-slot-avatar-img" loading="lazy">`
        : `<span class="gh-slot-avatar-placeholder">${_esc((owner || "?").charAt(0))}</span>`;
      repoCards.push(
        `<a href="${href}" class="gh-slot-card gh-slot-repo">` +
        `<div class="gh-slot-repo-head">` +
        `<span class="gh-slot-avatar">${avatarHtml}</span>` +
        `<div class="gh-slot-repo-meta">` +
        `<span class="gh-slot-repo-name">${fullName}</span>` +
        (lang ? `<span class="gh-slot-repo-lang">${lang}</span>` : "") +
        `</div>` +
        `<span class="gh-slot-stars" title="Stars">★ ${stars}</span>` +
        `</div>` +
        (desc ? `<p class="gh-slot-desc">${desc}</p>` : "") +
        `</a>`
      );
    }

    for (const login of users) {
      const data = await _fetchUser(login);
      if (!data) continue;
      const name = _esc(data.name || data.login);
      const bio = _esc((data.bio || "").slice(0, 120));
      const href = _esc(data.html_url || `https://github.com/${login}`);
      const avatarUrl = data.avatar_url ? _esc(data.avatar_url) : "";
      const avatarHtml = avatarUrl
        ? `<img src="${avatarUrl}" alt="" class="gh-slot-avatar-img" loading="lazy">`
        : `<span class="gh-slot-avatar-placeholder">${_esc((data.login || "?").charAt(0))}</span>`;
      const reposCount = _formatCount(data.public_repos);
      const followersCount = _formatCount(data.followers);
      userCards.push(
        `<a href="${href}" class="gh-slot-card gh-slot-user">` +
        `<div class="gh-slot-user-head">` +
        `<span class="gh-slot-avatar gh-slot-avatar--user">${avatarHtml}</span>` +
        `<div class="gh-slot-user-meta">` +
        `<span class="gh-slot-user-name">${name}</span>` +
        `<span class="gh-slot-user-login">@${_esc(data.login)}</span>` +
        `</div>` +
        `</div>` +
        (bio ? `<p class="gh-slot-desc">${bio}</p>` : "") +
        `<div class="gh-slot-user-stats">` +
        `<span>${reposCount} repos</span><span>${followersCount} followers</span>` +
        `</div>` +
        `</a>`
      );
    }

    const parts = [];
    if (repoCards.length) {
      parts.push(`<div class="gh-slot-section"><h4 class="gh-slot-heading">Repositories</h4><div class="gh-slot-grid">${repoCards.join("")}</div></div>`);
    }
    if (userCards.length) {
      parts.push(`<div class="gh-slot-section"><h4 class="gh-slot-heading">Users</h4><div class="gh-slot-grid">${userCards.join("")}</div></div>`);
    }
    const content = `<div class="gh-slot-wrap">${parts.join("")}</div>`;
    return { title: "GitHub", html: _render({ content }) };
  },
};

export default { slot };
