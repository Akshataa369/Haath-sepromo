"""
Makes docs/: a copy of the frontend that GitHub Pages can host (no Python server).
Run from the project folder:  python3 tools/build_static.py
Then on GitHub: Settings > Pages > Deploy from a branch > main, folder /docs.
"""
import re, shutil
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src, out = root / "frontend", root / "docs"
if out.exists():
    shutil.rmtree(out)
shutil.copytree(src, out)
(out / ".nojekyll").write_text("")          # serve files as they are

for page in out.glob("*.html"):
    s = page.read_text()
    s = s.replace('"/static/', '"')         # /static/css/x.css -> css/x.css
    s = s.replace('href="/"', 'href="index.html"')
    s = s.replace('href="/learn"', 'href="learn.html"')
    s = s.replace('href="/setup"', 'href="setup.html"')
    page.write_text(s)

landing = out / "js" / "landing.js"
landing.write_text(landing.read_text().replace('location.href = "/learn"', 'location.href = "learn.html"'))

left = [str(p.relative_to(out)) for p in out.rglob("*.html") if re.search(r'"/static/|href="/(learn|setup)?"', p.read_text())]
print("docs/ ready" + (f" (check paths in {left})" if left else ""))
