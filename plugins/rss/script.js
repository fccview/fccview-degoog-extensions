(function () {
  var params = new URLSearchParams(window.location.search);
  if (params.get("q") || window.location.pathname !== "/") return;

  var main = document.getElementById("main-home");
  if (!main) return;

  var feedPage = 1;
  var loading = false;
  var exhausted = false;
  var showOnDesktop = false;
  var observer = null;
  var cardTpl = "";

  var isDesktop = function () { return window.matchMedia("(min-width: 768px)").matches; };

  function escapeHtml(str) {
    var el = document.createElement("span");
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
    var date = new Date(dateStr);
    if (isNaN(date.getTime())) return "";
    var diff = Date.now() - date.getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + "h ago";
    var days = Math.floor(hours / 24);
    if (days < 7) return days + "d ago";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function faviconUrl(url) {
    try {
      var hostname = new URL(url).hostname;
      return "/api/proxy/image?url=" + encodeURIComponent("https://www.google.com/s2/favicons?domain=" + hostname + "&sz=128");
    } catch (e) { return ""; }
  }

  function skeletonCards(count) {
    var html = '<div class="skeleton-feed" aria-hidden="true">';
    for (var i = 0; i < count; i++) {
      html += '<div class="skeleton-feed-card"><div class="skeleton-feed-image"></div><div class="skeleton-feed-body"><div class="skeleton-feed-line skeleton-feed-source"></div><div class="skeleton-feed-line skeleton-feed-title"></div></div></div>';
    }
    html += "</div>";
    return html;
  }

  function renderCard(item) {
    var image = item.thumbnail
      ? '<img class="home-feed-card-img" src="' + escapeHtml(proxyImageUrl(item.thumbnail)) + '" alt="" loading="lazy" onerror="this.parentElement.querySelector(\'.home-feed-card-img\')?.remove()">'
      : '<div class="home-feed-card-favicon-wrap"><img class="home-feed-card-favicon" src="' + escapeHtml(faviconUrl(item.url)) + '" alt="" loading="lazy" onerror="this.parentElement.remove()"></div>';
    var source = escapeHtml(item.source || cleanHostname(item.url));
    var dateStr = formatDate(item.pubDate);
    var datePart = dateStr
      ? '<span class="home-feed-card-date">' + escapeHtml(dateStr) + "</span>"
      : "";

    if (cardTpl) {
      return cardTpl.replace(/\{\{(\w+)\}\}/g, function (_, key) {
        var map = {
          itemUrl: escapeHtml(item.url),
          image: image,
          source: source,
          datePart: datePart,
          title: escapeHtml(item.title),
        };
        return map[key] != null ? map[key] : "";
      });
    }

    return '<a class="home-feed-card" href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">'
      + image
      + '<div class="home-feed-card-body">'
      + '<div class="home-feed-card-meta"><span class="home-feed-card-source">' + source + "</span>" + datePart + "</div>"
      + '<div class="home-feed-card-title">' + escapeHtml(item.title) + "</div>"
      + "</div></a>";
  }

  function createCardElement(item) {
    var temp = document.createElement("div");
    temp.innerHTML = renderCard(item);
    return temp.firstChild;
  }

  function insertSorted(container, sentinel, cardEl, pubDate) {
    var ts = pubDate ? new Date(pubDate).getTime() : 0;
    if (isNaN(ts)) ts = 0;
    var cards = container.querySelectorAll(".home-feed-card");
    for (var i = 0; i < cards.length; i++) {
      var cardTs = Number(cards[i].dataset.ts || "0");
      if (ts > cardTs) {
        container.insertBefore(cardEl, cards[i]);
        return;
      }
    }
    container.insertBefore(cardEl, sentinel);
  }

  async function fetchPage(page) {
    var res = await fetch("/api/plugin/rss/feed?page=" + page);
    if (!res.ok) return [];
    var data = await res.json();
    if (data.showOnDesktop !== undefined) showOnDesktop = data.showOnDesktop;
    if (data.cardTemplate && !cardTpl) cardTpl = data.cardTemplate;
    return data.results || [];
  }

  async function loadMore(container) {
    if (loading || exhausted) return;
    loading = true;
    var items = await fetchPage(feedPage);
    if (items.length === 0) {
      exhausted = true;
      var s = container.querySelector(".home-feed-sentinel");
      if (s) s.remove();
      loading = false;
      return;
    }
    var sentinel = container.querySelector(".home-feed-sentinel");
    var fragment = document.createDocumentFragment();
    var temp = document.createElement("div");
    temp.innerHTML = items.map(renderCard).join("");
    while (temp.firstChild) fragment.appendChild(temp.firstChild);
    container.insertBefore(fragment, sentinel);
    feedPage++;
    loading = false;
  }

  function initStream(container, desktop, sentinel) {
    var gotItems = false;
    var skeletonRemoved = false;
    var es = new EventSource("/api/plugin/rss/feed/stream");

    function removeSkeleton() {
      if (skeletonRemoved) return;
      skeletonRemoved = true;
      container.classList.remove("home-news-feed--loading");
      var sk = container.querySelector(".skeleton-feed");
      if (sk) sk.remove();
    }

    es.addEventListener("init", function (e) {
      var data = JSON.parse(e.data);
      showOnDesktop = data.showOnDesktop;
      if (data.cardTemplate) cardTpl = data.cardTemplate;
      if (desktop && !showOnDesktop) {
        es.close();
        container.remove();
        return;
      }
      if (desktop && showOnDesktop) {
        container.innerHTML = skeletonCards(6);
        container.classList.add("home-news-feed--loading", "home-news-feed--desktop");
        container.appendChild(sentinel);
      }
    });

    es.addEventListener("items", function (e) {
      var items = JSON.parse(e.data);
      if (!items.length) return;
      if (!gotItems) {
        gotItems = true;
        removeSkeleton();
      }
      for (var i = 0; i < items.length; i++) {
        var card = createCardElement(items[i]);
        var ts = items[i].pubDate ? new Date(items[i].pubDate).getTime() : 0;
        if (isNaN(ts)) ts = 0;
        card.dataset.ts = ts;
        insertSorted(container, sentinel, card, items[i].pubDate);
      }
    });

    es.addEventListener("done", function () {
      es.close();
      removeSkeleton();
      if (!gotItems) {
        if (!desktop) main.classList.remove("has-feed");
        container.remove();
        return;
      }
      exhausted = true;
    });

    es.onerror = function () {
      es.close();
      removeSkeleton();
      if (!gotItems) {
        if (!desktop) main.classList.remove("has-feed");
        container.remove();
      }
    };
  }

  function init() {
    var container = document.createElement("div");
    container.className = "home-news-feed";
    var desktop = isDesktop();

    if (!desktop) {
      container.innerHTML = skeletonCards(4);
      container.classList.add("home-news-feed--loading");
      main.classList.add("has-feed");
    }

    main.appendChild(container);

    var sentinel = document.createElement("div");
    sentinel.className = "home-feed-sentinel";
    container.appendChild(sentinel);

    initStream(container, desktop, sentinel);
  }

  init();
})();
