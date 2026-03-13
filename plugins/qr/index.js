const QR_API = "https://api.qrserver.com/v1/create-qr-code/";
const SIZE = 256;

const _esc = (s) => {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const _extractUrl = (args) => {
  const t = args.trim();
  const urlMatch = t.match(/https?:\/\/[^\s]+/);
  if (urlMatch) return urlMatch[0].replace(/[.,;:!?)]+$/, "");
  if (/^[a-z0-9-]+\.[a-z]{2,}(\/.*)?$/i.test(t)) return `https://${t}`;
  return t ? `https://${t}` : "";
};

export default {
  name: "QR Code",
  description: "Generate a QR code for a URL.",
  trigger: "qr",
  aliases: ["qrcode"],
  naturalLanguagePhrases: ["qr code for", "qrcode for", "generate qr for"],

  settingsSchema: [],

  execute(args) {
    const raw = args.trim();
    if (!raw) {
      return {
        title: "QR Code",
        html: `<div class="command-result"><p>Usage: <code>!qr &lt;url&gt;</code></p><p>Example: <code>!qr https://example.com</code> or &quot;qr code for https://example.com&quot;</p></div>`,
      };
    }
    const url = _extractUrl(raw);
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return {
        title: "QR Code",
        html: `<div class="command-result"><p>Usage: <code>!qr &lt;url&gt;</code></p><p>Example: <code>!qr https://example.com</code></p></div>`,
      };
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        title: "QR Code",
        html: `<div class="command-result"><p>URL must use HTTP or HTTPS.</p></div>`,
      };
    }
    const imgUrl = `${QR_API}?size=${SIZE}x${SIZE}&data=${encodeURIComponent(url)}`;
    const html = `<div class="command-result qr-result"><p class="qr-label">${_esc(url)}</p><img src="${_esc(imgUrl)}" alt="QR code" class="qr-image" width="${SIZE}" height="${SIZE}"></div>`;
    return { title: "QR Code", html };
  },
};
