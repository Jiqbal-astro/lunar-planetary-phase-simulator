"""End-to-end browser test: operates every control in headless Chromium.
Run:  python tests/test_browser.py   (needs playwright + a local plotly.min.js, see tools/browser.py)"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools"))
from browser import serve, open_page
from playwright.sync_api import sync_playwright

checks = []
def check(name, cond, detail=""):
    checks.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""))

def jd(page): return page.evaluate("PhaseApp.state.jd")
def set_date(page, iso):
    page.fill("#dateInput", iso); page.dispatch_event("#dateInput", "change"); page.wait_for_timeout(300)
def text(page, sel): return page.inner_text(sel)
def lit_pixels(page):
    return page.evaluate("""(() => { const c = document.getElementById('skyCanvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i+1] > 140) n++; return n; })()""")

serve(port=8781)
with sync_playwright() as p:
    b, page, errors = open_page(p, "http://127.0.0.1:8781/index.html", 1440, 1000)

    # ------------------------------------------------------------- Moon
    set_date(page, "2024-01-25T17:54")
    check("date input: full Moon on 2024-01-25", text(page, "#phaseName") == "Full Moon", text(page, "#phaseName"))
    full_px = lit_pixels(page)
    set_date(page, "2024-01-11T11:57")
    check("date input: new Moon on 2024-01-11", text(page, "#phaseName") == "New Moon")
    check("disk: new Moon has (almost) no lit pixels; full Moon many", lit_pixels(page) < 0.02 * full_px and full_px > 50000, f"{full_px}")
    j0 = jd(page)
    page.click("button.step[data-step='1']"); page.wait_for_timeout(200)
    check("+1 day button", abs(jd(page) - j0 - 1) < 1e-6)
    page.click("button.step[data-step='-1']"); page.click("button.step[data-step='0.041666667']"); page.wait_for_timeout(200)
    check("−1 day and +1 hour buttons", abs((jd(page) - j0) * 24 - 1) < 1e-4)
    page.click("button.step[data-step='-0.041666667']"); page.wait_for_timeout(200)
    check("−1 hour button", abs(jd(page) - j0) < 1e-6)
    for target, name in ((90, "First quarter"), (180, "Full Moon"), (270, "Last quarter"), (0, "New Moon")):
        page.click(f"button.jump[data-target='{target}']"); page.wait_for_timeout(250)
        check(f"Jump to {name}", text(page, "#phaseName") == name, text(page, "#phaseSub"))
    up = page.inner_text("#upcoming")
    check("upcoming phases listed", all(n in up for n in ("New Moon", "First quarter", "Full Moon", "Last quarter")))
    j1 = jd(page); page.click("#upcoming button >> nth=0"); page.wait_for_timeout(250)
    check("clicking an upcoming phase jumps to it", jd(page) > j1)
    box = page.locator("#monthCanvas").bounding_box()
    j2 = jd(page); page.mouse.click(box["x"] + box["width"] * (16.5 / 29), box["y"] + 30); page.wait_for_timeout(250)
    check("month strip: clicking a day two days later jumps there", abs(jd(page) - j2 - 2) < 0.01, f"{jd(page) - j2:.3f}")
    page.locator("#moonPlot").scroll_into_view_if_needed(); page.wait_for_timeout(200)
    pb = page.locator("#moonPlot .nsewdrag").first.bounding_box()
    j3 = jd(page); page.mouse.click(pb["x"] + pb["width"] * 0.8, pb["y"] + pb["height"] / 2); page.wait_for_timeout(300)
    check("clicking the illumination curve jumps in time", jd(page) - j3 > 5, f"{jd(page) - j3:.2f} d")
    page.click("#nowBtn"); page.wait_for_timeout(250)
    check("Now button", abs(jd(page) - page.evaluate("Astro.julianDay(new Date())")) < 0.01)
    page.select_option("#speedSelect", "7")
    j4 = jd(page); page.click("#playBtn"); page.wait_for_timeout(1200); page.click("#playBtn"); page.wait_for_timeout(200)
    check("time-lapse plays at ~1 week per second", 4 < jd(page) - j4 < 12, f"{jd(page) - j4:.2f} d")
    j5 = jd(page); page.wait_for_timeout(400)
    check("pause stops the time-lapse", jd(page) == j5)
    page.keyboard.press("ArrowRight"); page.wait_for_timeout(150)
    check("right arrow key = +1 day", abs(jd(page) - j5 - 1) < 1e-6)

    # orientation: sky view needs a location; a waxing evening Moon is lit towards the horizon
    set_date(page, "2024-01-15T17:00")
    page.click("#orientSeg button[data-orient='sky']"); page.wait_for_timeout(200)
    check("sky view without a location asks for one", "Enter your latitude" in text(page, "#locNote"))
    page.fill("#latInput", "51.48"); page.dispatch_event("#latInput", "change")
    page.fill("#lonInput", "0"); page.dispatch_event("#lonInput", "change"); page.wait_for_timeout(300)
    cap = text(page, "#skyCaption")
    check("sky view with location shows altitude and zenith", "zenith up" in cap and "Altitude" in text(page, "#readouts"), cap)
    lower_right = page.evaluate("""(() => { const c = document.getElementById('skyCanvas'); const g = c.getContext('2d');
        const w = c.width, h = c.height; let lr = 0, ul = 0;
        const d = g.getImageData(0, 0, w, h).data;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i] > 150 && d[i+1] > 140 && d[i+2] > 120) { if (x > w/2 && y > h/2) lr++; if (x < w/2 && y < h/2) ul++; } }
        return [lr, ul]; })()""")
    check("evening crescent seen from London is lit towards the lower right (the set Sun)", lower_right[0] > 5 * max(1, lower_right[1]), str(lower_right))
    page.fill("#latInput", "200"); page.dispatch_event("#latInput", "change"); page.wait_for_timeout(150)
    check("invalid latitude is flagged", "invalid" in (page.get_attribute("#latInput", "class") or ""))
    page.fill("#latInput", "51.48"); page.dispatch_event("#latInput", "change")
    page.click("#orientSeg button[data-orient='north']"); page.wait_for_timeout(200)
    check("north-up view", "North up" in text(page, "#skyCaption"))

    # ---------------------------------------------------------- planets
    page.click("#tab-planets"); page.wait_for_timeout(300)
    set_date(page, "2023-08-13T11:00")
    check("Venus at inferior conjunction is new", "Venus" in text(page, "#phaseName") and "too close to the Sun" in text(page, "#phaseSub"))
    for planet in ("mercury", "mars", "jupiter", "venus"):
        page.click(f"#planetSeg button[data-planet='{planet}']"); page.wait_for_timeout(300)
        check(f"planet button: {planet}", planet.capitalize() in text(page, "#phaseName"))
    set_date(page, "2023-06-04T00:00")
    rd = text(page, "#readouts")
    check("Venus half lit at greatest elongation 2023-06-04", "Half lit" in text(page, "#phaseName") and "45." in rd, text(page, "#phaseName"))
    big = lit_pixels(page)
    page.click("#trueSize"); page.wait_for_timeout(300)
    check("true-size toggle off draws a bigger disk", lit_pixels(page) > 1.5 * big)
    page.click("#trueSize"); page.wait_for_timeout(200)
    page.locator("#planetPlot").scroll_into_view_if_needed(); page.wait_for_timeout(200)
    pb = page.locator("#planetPlot .nsewdrag").first.bounding_box()
    j6 = jd(page); page.mouse.click(pb["x"] + pb["width"] * 0.9, pb["y"] + 40); page.wait_for_timeout(300)
    check("clicking the planet chart jumps in time", jd(page) - j6 > 100, f"{jd(page) - j6:.0f} d")
    check("orbit diagram drawn", page.evaluate("document.getElementById('orbitCanvas').getContext('2d').getImageData(0,0,50,50).data.length") > 0)

    # -------------------------------------------------------- exoplanets
    page.click("#tab-exo"); page.wait_for_timeout(400)
    opts = page.evaluate("[...document.querySelectorAll('#exoSelect option')].map(o => o.value)")
    for o in opts[:-1]:
        page.select_option("#exoSelect", o); page.wait_for_timeout(250)
        check(f"exoplanet preset {o} loads with a note", len(text(page, "#exoNote")) > 20)
    page.select_option("#exoSelect", "kepler7b"); page.wait_for_timeout(300)
    amp = page.evaluate("Math.max(...document.getElementById('exoPlot').data.find(t => t.name === 'Model').y)")
    check("Kepler-7 b amplitude ~50 ppm", 45 < amp < 58, f"{amp:.1f} ppm")
    y_ecl = page.evaluate("(() => { const t = document.getElementById('exoPlot').data.find(t => t.name === 'Model'); return t.y[400]; })()")
    check("flux is zero during secondary eclipse", y_ecl == 0)
    page.fill("#ex-albedo", "0.7"); page.dispatch_event("#ex-albedo", "change"); page.wait_for_timeout(300)
    amp2 = page.evaluate("Math.max(...document.getElementById('exoPlot').data.find(t => t.name === 'Model').y)")
    check("editing albedo doubles the amplitude and switches to Custom", abs(amp2 / amp - 2) < 0.01 and page.input_value("#exoSelect") == "custom")
    page.fill("#ex-ecc", "1.5"); page.dispatch_event("#ex-ecc", "change"); page.wait_for_timeout(200)
    check("invalid eccentricity flagged", "invalid" in (page.get_attribute("#ex-ecc", "class") or ""))
    page.fill("#ex-ecc", "0.4"); page.dispatch_event("#ex-ecc", "change")
    page.fill("#ex-inc", "60"); page.dispatch_event("#ex-inc", "change"); page.wait_for_timeout(300)
    check("non-transiting custom orbit: no transit or eclipse", "no / no" in text(page, "#readouts"))
    page.select_option("#ex-unit", "earth"); page.wait_for_timeout(300)
    amp3 = page.evaluate("Math.max(...document.getElementById('exoPlot').data.find(t => t.name === 'Model').y)")
    check("radius unit switch (R♃ to R⊕) shrinks the signal ~126×", amp3 < amp2 / 100, f"{amp3:.3f} ppm")
    page.select_option("#exoSelect", "hd209458b"); page.wait_for_timeout(300)
    page.focus("#ex-inc"); page.locator("#ex-inc").blur(); page.wait_for_timeout(200)
    check("selecting a preset then leaving a field keeps the preset (no false 'Custom')", page.input_value("#exoSelect") == "hd209458b")
    page.eval_on_selector("#exoPhase", "el => { el.value = 0.25; el.dispatchEvent(new Event('input')); }"); page.wait_for_timeout(200)
    check("orbital phase slider", "0.250" in text(page, "#exoPhaseOut") and "Half" not in text(page, "#phaseName"))
    page.locator("#exoPlot").scroll_into_view_if_needed(); page.wait_for_timeout(200)
    pb = page.locator("#exoPlot .nsewdrag").first.bounding_box()
    page.mouse.click(pb["x"] + pb["width"] * 0.75, pb["y"] + 40); page.wait_for_timeout(300)
    check("clicking the phase curve moves the planet", abs(page.evaluate("PhaseApp.state.exoPhase") - 0.75) < 0.02)
    ph0 = page.evaluate("PhaseApp.state.exoPhase")
    page.click("#exoPlay"); page.wait_for_timeout(900)
    ph1 = page.evaluate("PhaseApp.state.exoPhase")
    page.click("#exoPlay")
    check("orbit play animates the phase", ph1 != ph0, f"{ph0} -> {ph1}")
    page.click("#exoNoise"); page.wait_for_timeout(300)
    names = page.evaluate("document.getElementById('exoPlot').data.map(t => t.name)")
    check("simulated observations: data and binned points", "Simulated data" in names and "Binned" in names)
    page.fill("#exoSigmaNum", "5"); page.dispatch_event("#exoSigmaNum", "change"); page.wait_for_timeout(200)
    check("noise number box", abs(page.evaluate("PhaseApp.state.sigma") - 5) < 1e-9)

    # -------------------------------------------------------------- theme
    page.click("#themeToggle"); page.wait_for_timeout(300)
    check("theme toggle to dark", page.evaluate("document.documentElement.dataset.theme") == "dark")
    page.click("#themeToggle"); page.wait_for_timeout(300)
    check("theme toggle back to white", page.evaluate("document.documentElement.dataset.theme") == "light")
    check("no JavaScript errors during the session", not errors, "; ".join(errors[:3]))
    b.close()

failed = [c for c in checks if not c[1]]
print(f"\n{len(checks) - len(failed)} / {len(checks)} checks passed")
sys.exit(1 if failed else 0)
