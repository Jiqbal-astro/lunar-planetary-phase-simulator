"""Inline CSS and JS into one self-contained HTML file (for sharing a single file)."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
html = (ROOT / "index.html").read_text()
html = html.replace('<link rel="stylesheet" href="css/style.css">',
                    "<style>\n" + (ROOT / "css/style.css").read_text() + "\n</style>")
for js in ("js/astro.js", "js/phase.js", "js/app.js"):
    html = html.replace(f'<script src="{js}"></script>', "<script>\n" + (ROOT / js).read_text() + "\n</script>")
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "lunar-planetary-phase-simulator.html"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html)
assert 'src="js/' not in html and 'href="css/' not in html
print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
