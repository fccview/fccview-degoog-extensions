const DEFAULT_LENGTH = 16;
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;
const CHARS_LOWER = "abcdefghijklmnopqrstuvwxyz";
const CHARS_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CHARS_DIGIT = "0123456789";
const CHARS_SYMBOL = "!@#$%^&*()-_=+[]{}|;:,.<>?";

const _esc = (s) => {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const _parseLength = (args) => {
  const t = args.trim();
  if (!t) return DEFAULT_LENGTH;
  const num = parseInt(t, 10);
  if (!Number.isFinite(num)) return DEFAULT_LENGTH;
  return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, num));
};

const _randomPassword = (length) => {
  const pool = CHARS_LOWER + CHARS_UPPER + CHARS_DIGIT + CHARS_SYMBOL;
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += pool[bytes[i] % pool.length];
  }
  return out;
};

export default {
  name: "Password",
  description: "Generate a random password.",
  trigger: "password",
  aliases: ["pw", "pass", "genpass"],
  naturalLanguagePhrases: ["generate password", "random password", "new password"],

  settingsSchema: [],

  execute(args) {
    const length = _parseLength(args);
    const password = _randomPassword(length);
    const html = `<div class="command-result password-result"><p class="password-label">Generated password (${length} chars)</p><p class="password-value"><code>${_esc(password)}</code></p><p class="password-hint">Copy and use in a password manager.</p></div>`;
    return { title: "Password", html };
  },
};
