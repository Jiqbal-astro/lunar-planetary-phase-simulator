"""Headless-browser harness: serves the site and routes CDN requests to local copies."""
import functools, http.server, threading, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
import os
# Local copy of Plotly so the tests run offline: `npm install` puts it in node_modules
PLOTLY = pathlib.Path(os.environ.get("PLOTLY_JS", ROOT / "node_modules/plotly.js-dist-min/plotly.min.js"))
if not PLOTLY.exists():
    PLOTLY = pathlib.Path("/tmp/npmx/node_modules/plotly.js-dist-min/plotly.min.js")

def serve(directory=ROOT, port=8765):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    handler.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def open_page(p, url, width=1440, height=1000, scheme="light"):
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": width, "height": height}, color_scheme=scheme)
    page.route("**/plotly.min.js", lambda r: r.fulfill(path=str(PLOTLY), content_type="application/javascript"))
    page.route("**/fonts.googleapis.com/**", lambda r: r.fulfill(body="", content_type="text/css"))
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(url)
    page.wait_for_function("window.PhaseApp && document.getElementById('readouts').children.length > 0")
    page.wait_for_timeout(600)
    return browser, page, errors
