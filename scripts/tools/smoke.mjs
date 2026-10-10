// Headless smoke test for CI:  npx playwright install chromium && node scripts/tools/smoke.mjs [url]
// Serves nothing itself: start the viewer first (python3 scripts/tools/serve.py) or pass a deployed URL.
// It opens ?debug&selftest, waits for the in-page test (viewer/js/selftest.js) and exits non-zero with the failed checks.
// NOTE: written but not yet run in this repo (Playwright is not installed here); the same test passes in the Browser pane (16/16 on 2026-10-10).
import { chromium } from "playwright";
const base = process.argv[2] || "http://localhost:8765/viewer/index.html";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto(`${base}?debug&selftest&nocache=${Date.now()}`);
await page.waitForFunction(() => window.__selftest, null, { timeout: 180000 });
const res = await page.evaluate(() => window.__selftest);
await browser.close();
for (const r of res.results) console.log(`${r.pass ? "ok  " : "FAIL"} ${r.name}${r.pass ? "" : " :: " + r.detail}`);
if (errors.length) console.log("page errors:", errors);
process.exit(res.pass && !errors.length ? 0 : 1);
