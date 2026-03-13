let mathEnabled = true;
let templateHtml = "";
let styleCss = "";

const MATH_PATTERN = /^[a-z0-9\s+\-*/.^()[\]{},]+$/i;
const HAS_DIGIT = /\d/;

const _esc = (s) => {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const _formatMath = (expr) => {
  return expr
    .replace(/\*/g, " × ")
    .replace(/\//g, " ÷ ")
    .replace(/sqrt\(/gi, "√(")
    .replace(/root\(/gi, "√(");
};

export const slot = {
  id: "math-slot",
  name: "Math",
  description: "Evaluates math expressions natively via API.",
  position: "at-a-glance",

  settingsSchema: [
    {
      key: "enabled",
      label: "Enabled",
      type: "toggle",
    },
  ],

  async init(ctx) {
    if (ctx.readFile) {
      templateHtml = await ctx.readFile("template.html");
    }
  },

  configure(settings) {
    mathEnabled = settings?.enabled !== "false";
  },

  trigger(query) {
    const q = query.trim();
    if (!mathEnabled || q.length < 1 || q.length > 80) return false;
    return HAS_DIGIT.test(q) && MATH_PATTERN.test(q);
  },

  async execute(query) {
    const originalQuery = query.trim();
    let safeQuery = originalQuery.toLowerCase();
    
    safeQuery = safeQuery.replace(/\[/g, "(").replace(/\]/g, ")");
    safeQuery = safeQuery.replace(/\{/g, "(").replace(/\}/g, ")");
    safeQuery = safeQuery.replace(/root\(/g, "sqrt(");

    const q = encodeURIComponent(safeQuery);
    
    try {
      const res = await fetch(`https://api.mathjs.org/v4/?expr=${q}`);
      if (!res.ok) return { html: "" };
      
      let result = await res.text();
      
      const numResult = Number(result);
      if (!isNaN(numResult)) {
        result = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(numResult);
      }
      
      const finalHtml = (templateHtml || '<div class="math-widget">{{query}} = {{result}}</div>')
        .replace("{{query}}", _esc(_formatMath(originalQuery)))
        .replace("{{result}}", _esc(result));
      
      return { html: finalHtml };
    } catch {
      return { html: "" };
    }
  },
};

export default { slot };