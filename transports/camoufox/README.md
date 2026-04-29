# Camoufox — degoog setup

Run a self-hosted Camoufox (stealth Firefox) service that degoog can route requests through.

## 1. Files

Create a folder (e.g. `~/camoufox`) with these four files:

### `docker-compose.yml`

```yaml
services:
  camoufox:
    build: .
    restart: unless-stopped
    ports:
      - "53323:3000"
    shm_size: "2gb"
```

### `Dockerfile`

```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y \
  libgtk-3-0 libx11-xcb1 libdbus-glib-1-2 libxt6 \
  ca-certificates --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m camoufox fetch
COPY server.py .
EXPOSE 3000
CMD ["python", "server.py"]
```

### `requirements.txt`

```
camoufox[geoip]
aiohttp
```

### `server.py`

```python
import asyncio
import json
from aiohttp import web
from camoufox.async_api import AsyncCamoufox

_browser = None
_camoufox = None

async def get_browser():
    global _browser, _camoufox
    if _browser:
        return _browser
    _camoufox = AsyncCamoufox(headless=True)
    _browser = await _camoufox.__aenter__()
    return _browser

async def handle_content(request):
    try:
        body = await request.json()
    except Exception:
        return web.Response(status=400, text='{"error":"invalid json"}', content_type="application/json")

    url = body.get("url")
    if not url:
        return web.Response(status=400, text='{"error":"url is required"}', content_type="application/json")

    goto_options = body.get("gotoOptions", {})
    cookies = body.get("cookies", [])

    browser = await get_browser()
    context = await browser.new_context()
    try:
        if cookies:
            await context.add_cookies(cookies)
        page = await context.new_page()
        await page.goto(
            url,
            wait_until=goto_options.get("waitUntil", "networkidle"),
            timeout=goto_options.get("timeout", 15000),
        )
        html = await page.content()
        return web.Response(text=html, content_type="text/html")
    finally:
        await context.close()

app = web.Application()
app.router.add_post("/content", handle_content)

if __name__ == "__main__":
    web.run_app(app, host="0.0.0.0", port=3000)
```

## 2. Start it

```bash
docker compose up -d --build
```

The first build downloads the Camoufox browser binaries (`python -m camoufox fetch`), so it can take a few minutes.

## 3. Configure in degoog

Settings → Transports → Camoufox → Configure:

- **Camoufox URL**: `http://127.0.0.1:53323` (or wherever you exposed the service)

Then, in Settings → Engines → Configure → Advanced, pick `camoufox` as the outgoing transport for any engine you want routed through it.
