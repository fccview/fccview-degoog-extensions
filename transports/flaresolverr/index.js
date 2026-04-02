export default class FlareSolverrTransport {
  name = "flaresolverr";
  displayName = "FlareSolverr";
  description =
    "Bypass Cloudflare challenges via a FlareSolverr instance. Once configured, engines can select flaresolverr as their outgoing transport.";

  settingsSchema = [
    {
      key: "url",
      label: "FlareSolverr URL",
      type: "url",
      required: true,
      placeholder: "http://127.0.0.1:8191/v1",
      description: "The URL of your FlareSolverr instance.",
    },
    {
      key: "timeout",
      label: "Timeout (ms)",
      type: "number",
      placeholder: "12000",
      description: "Max time to wait for a FlareSolverr response (1000–60000).",
    },
    {
      key: "bypassProxy",
      label: "Bypass proxy for FlareSolverr endpoint",
      type: "toggle",
      default: "true",
      description: "Connect directly to the FlareSolverr instance instead of routing through the proxy. Enable this when FlareSolverr is on your local network.",
    },
  ];

  _url = "";
  _bypassProxy = true;
  timeoutMs = 12000;

  configure(settings) {
    this._url = (settings.url || "").trim();
    this._bypassProxy = settings.bypassProxy !== "false";
    this.timeoutMs = Math.max(
      1000,
      Math.min(60000, Number(settings.timeout) || 12000),
    );
  }

  available() {
    return this._url.length > 0;
  }

  async fetch(url, options, context) {
    const doFetch = context.fetch;

    if (!this._url) {
      return doFetch(url, {
        method: options.method ?? "GET",
        redirect: options.redirect ?? "follow",
        signal: options.signal,
        headers: options.headers,
        body: options.body,
      });
    }

    const payload = JSON.stringify({
      cmd: "request.get",
      url,
      maxTimeout: this.timeoutMs,
    });

    const endpointFetch = this._bypassProxy ? fetch : doFetch;
    const res = await endpointFetch(this._url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: payload,
      redirect: "follow",
      signal: options.signal,
    });

    if (!res.ok) return new Response("", { status: res.status });
    const data = await res.json();
    const html = data?.solution?.response ?? "";
    const status = data?.solution?.status ?? 200;
    return new Response(html, {
      status,
      headers: { "Content-Type": "text/html" },
    });
  }
}
