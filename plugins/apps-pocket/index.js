let apps = [];

const _normalizeApps = (input) => {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const url = typeof item.url === "string" ? item.url.trim() : "";
    const icon = typeof item.icon === "string" ? item.icon.trim() : "";
    if (!label || !url) continue;
    out.push({ label, icon, url });
  }
  return out;
};

const _json = (body, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
};

export default {
  name: "Apps pocket",
  description: "Adds a Google-style apps grid next to the settings icon. Each app has a label, icon URL and link.",
  trigger: "apps",
  aliases: [],

  settingsSchema: [
    {
      key: "appsJson",
      label: "Apps (JSON)",
      type: "textarea",
      placeholder: '[{"label":"Gmail","icon":"https://.../icon.png","url":"https://mail.google.com"}]',
      description: "JSON array of {label, icon, url}. Labels and URLs are required; icon is an image URL and falls back to the first letter of the label.",
    },
  ],

  configure(settings) {
    const raw = typeof settings?.appsJson === "string" ? settings.appsJson.trim() : "";
    if (!raw) {
      apps = [];
      return;
    }
    try {
      apps = _normalizeApps(JSON.parse(raw));
    } catch {
      apps = [];
    }
  },

  async execute() {
    const html = `<div class="apps-pocket-bang">Configure your apps in Settings → Plugins → Apps pocket.</div>`;
    return { title: "Apps", html };
  },

  routes: [
    {
      method: "get",
      path: "/apps",
      handler: async () => _json({ apps }),
    },
  ],
};
