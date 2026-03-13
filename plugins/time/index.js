const TZ_MAP = {
  tokyo: "Asia/Tokyo",
  japan: "Asia/Tokyo",
  london: "Europe/London",
  uk: "Europe/London",
  "new york": "America/New_York",
  nyc: "America/New_York",
  "los angeles": "America/Los_Angeles",
  la: "America/Los_Angeles",
  chicago: "America/Chicago",
  paris: "Europe/Paris",
  berlin: "Europe/Berlin",
  sydney: "Australia/Sydney",
  dubai: "Asia/Dubai",
  singapore: "Asia/Singapore",
  mumbai: "Asia/Kolkata",
  india: "Asia/Kolkata",
  "hong kong": "Asia/Hong_Kong",
  beijing: "Asia/Shanghai",
  shanghai: "Asia/Shanghai",
  utc: "UTC",
  gmt: "UTC",
};

const _esc = (s) => {
  if (typeof s !== "string") return "";

  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const _resolveTimeZone = (input) => {
  const key = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (TZ_MAP[key]) return TZ_MAP[key];
  const normalized = key.replace(/\s+/g, "_");
  
  try {
    const formatter = new Intl.DateTimeFormat("en", { timeZone: normalized });
    formatter.format(new Date());
    return normalized;
  } catch {
    return null;
  }
};

export default {
  name: "Time",
  description: "Show current time in a timezone or city.",
  trigger: "time",
  aliases: ["tz", "clock"],
  naturalLanguagePhrases: ["what time is it in", "time in", "current time in", "what's the time in"],

  settingsSchema: [],

  execute(args) {
    const place = args.trim().replace(/[?.,!]+$/, "").trim();
    if (!place) {
      return {
        title: "Time",
        html: `<div class="command-result"><p>Usage: <code>!time &lt;city or timezone&gt;</code></p><p>Examples: <code>!time Tokyo</code>, <code>!time America/New_York</code></p></div>`,
      };
    }
    const tz = _resolveTimeZone(place);
    if (!tz) {
      return {
        title: "Time",
        html: `<div class="command-result"><p>Unknown timezone or city: <strong>${_esc(place)}</strong></p></div>`,
      };
    }
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const dateStr = now.toLocaleDateString("en-GB", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const label = tz.replace(/_/g, " ");
    const html = `<div class="command-result time-result"><h3 class="time-place">${_esc(label)}</h3><p class="time-time">${_esc(timeStr)}</p><p class="time-date">${_esc(dateStr)}</p></div>`;
    return { title: `Time: ${label}`, html };
  },
};
