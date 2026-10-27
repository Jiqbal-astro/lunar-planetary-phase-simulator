"""Regenerate the README screenshots:  python tools/screenshots.py"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from browser import serve, open_page, ROOT
from playwright.sync_api import sync_playwright

OUT = ROOT / "docs"
serve(port=8786)
with sync_playwright() as p:
    b, page, errors = open_page(p, "http://127.0.0.1:8786/index.html", 1440, 1000)
    page.evaluate("PhaseApp.setJD(Astro.julianDay(new Date('2024-01-18T20:00Z')), true)"); page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / "moon.png"))
    page.click("#tab-planets"); page.wait_for_timeout(300)
    page.evaluate("PhaseApp.setJD(Astro.julianDay(new Date('2023-07-25T00:00Z')), true)"); page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / "planets.png"), full_page=True)
    page.click("#tab-exo"); page.wait_for_timeout(300)
    page.click("#exoNoise"); page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / "exoplanets.png"))
    print("errors:", errors)
    b.close()
