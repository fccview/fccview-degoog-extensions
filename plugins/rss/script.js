(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get("q") || window.location.pathname !== "/") return;

  const main = document.getElementById("main-home");
  if (!main) return;

  let feedPage = 1;
  let loading = false;
  let exhausted = false;
  let showOnDesktop = false;
  let observer = null;

  const isDesktop = () => window.matchMedia("(min-width: 768px)").matches;

  function escapeHtml(str) {
    const el = document.createElement("span");
    el.textContent = str;
    return el.innerHTML;
  }

  function proxyImageUrl(url) {
    if (!url) return "";
    return "/api/proxy/image?url=" + encodeURIComponent(url);
  }

  function cleanHostname(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "";
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "h ago";
    const days = Math.floor(hours / 24);
    if (days < 7) return days + "d ago";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function skeletonCards(count) {
    let html = '<div class="skeleton-feed" aria-hidden="true">';
    for (let i = 0; i < count; i++) {
      html += '<div class="skeleton-feed-card"><div class="skeleton-feed-image"></div><div class="skeleton-feed-body"><div class="skeleton-feed-line skeleton-feed-source"></div><div class="skeleton-feed-line skeleton-feed-title"></div></div></div>';
    }
    html += "</div>";
    return html;
  }

  function faviconUrl(url) {
    try {
      var hostname = new URL(url).hostname;
      return "/api/proxy/image?url=" + encodeURIComponent("https://www.google.com/s2/favicons?domain=" + hostname + "&sz=128");
    } catch(e) { return ""; }
  }

  function renderCard(item) {
    const thumb = item.thumbnail
      ? '<img class="home-feed-card-img" src="' + escapeHtml(proxyImageUrl(item.thumbnail)) + '" alt="" loading="lazy" onerror="this.parentElement.querySelector(\'.home-feed-card-img\')?.remove()">'
      : '<div class="home-feed-card-favicon-wrap"><img class="home-feed-card-favicon" src="' + escapeHtml(faviconUrl(item.url)) + '" alt="" loading="lazy" onerror="this.parentElement.remove()"></div>';
    const source = item.source || cleanHostname(item.url);
    const dateStr = formatDate(item.pubDate);
    const datePart = dateStr
      ? '<span class="home-feed-card-date">' + escapeHtml(dateStr) + "</span>"
      : "";
    return '<a class="home-feed-card" href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">'
      + thumb
      + '<div class="home-feed-card-body">'
      + '<div class="home-feed-card-meta"><span class="home-feed-card-source">' + escapeHtml(source) + "</span>" + datePart + "</div>"
      + '<div class="home-feed-card-title">' + escapeHtml(item.title) + "</div>"
      + "</div></a>";
  }

  async function fetchPage(page) {
    const res = await fetch("/api/plugin/rss/feed?page=" + page);
    if (!res.ok) return [];
    const data = await res.json();
    if (page === 1 && data.showOnDesktop !== undefined) {
      showOnDesktop = data.showOnDesktop;
    }
    return data.results || [];
  }

  async function loadMore(container) {
    if (loading || exhausted) return;
    loading = true;
    const items = await fetchPage(feedPage);
    if (items.length === 0) {
      exhausted = true;
      const s = container.querySelector(".home-feed-sentinel");
      if (s) s.remove();
      loading = false;
      return;
    }
    const sentinel = container.querySelector(".home-feed-sentinel");
    const fragment = document.createDocumentFragment();
    const temp = document.createElement("div");
    temp.innerHTML = items.map(renderCard).join("");
    while (temp.firstChild) fragment.appendChild(temp.firstChild);
    container.insertBefore(fragment, sentinel);
    feedPage++;
    loading = false;
  }

  async function init() {
    const container = document.createElement("div");
    container.className = "home-news-feed";
    const desktop = isDesktop();

    container.innerHTML = skeletonCards(desktop ? 6 : 4);
    container.classList.add("home-news-feed--loading");
    if (!desktop) {
      main.classList.add("has-feed");
    } else {
      container.classList.add("home-news-feed--desktop");
    }

    main.appendChild(container);

    try {
      const items = await fetchPage(1);
      if (items.length === 0) {
        if (!desktop) main.classList.remove("has-feed");
        container.remove();
        return;
      }

      if (desktop && !showOnDesktop) {
        container.remove();
        return;
      }

      container.classList.remove("home-news-feed--loading");
      container.innerHTML = items.map(renderCard).join("") + '<div class="home-feed-sentinel"></div>';
      feedPage = 2;

      const sentinel = container.querySelector(".home-feed-sentinel");
      observer = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) loadMore(container);
      }, { rootMargin: "400px" });
      if (sentinel) observer.observe(sentinel);
    } catch {
      if (!desktop) main.classList.remove("has-feed");
      container.remove();
    }
  }

  init();
})();
