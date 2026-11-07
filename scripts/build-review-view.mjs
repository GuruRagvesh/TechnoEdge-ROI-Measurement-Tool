import { readFile, writeFile, cp, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { screens } = JSON.parse(
  await readFile("../final-review/screenshots/index.json", "utf8"),
);
const escape = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const view = ({ file, title, path }) =>
  `<article data-role="${file.startsWith("host") ? "host" : file.startsWith("public") ? "public" : "attendee"}"><h2>${escape(title)}</h2><a href="screenshots/final/${file}.png" target="_blank"><img src="screenshots/final/${file}.png" alt="${escape(title)} — actual local application" loading="lazy"></a><footer><a href="http://127.0.0.1:3000${path}">Open this page locally ↗</a><span>Synthetic test account</span></footer></article>`;
const css = `*{box-sizing:border-box}body{margin:0;background:#f2f5fa;color:#17243b;font:15px/1.5 system-ui,sans-serif}header,main{max-width:1560px;margin:auto;padding:32px}header{padding-bottom:20px}h1{font-size:36px;line-height:1.15;margin:12px 0}h2{font-size:16px;margin:0;padding:14px 18px}p{max-width:950px;color:#53647c}.kicker{letter-spacing:2px;font-size:12px;font-weight:800;color:#456385}.chips{display:flex;flex-wrap:wrap;gap:8px}.chips span,.button{border-radius:8px;padding:8px 12px;background:white;border:1px solid #d8e1ed;font-weight:650}.chips .pending{background:#fff3d3}.actions{display:flex;gap:12px;margin:18px 0}a{color:#234f93}nav{position:sticky;top:0;padding:12px 32px;background:#102644;z-index:2;display:flex;gap:10px}nav button{cursor:pointer;border:0;border-radius:6px;padding:9px 16px;background:#e9eff7;color:#102644;font-weight:650}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding-top:24px}article{background:white;border:1px solid #d7e0ed;border-radius:12px;overflow:hidden;align-self:start}article img{display:block;width:100%;height:auto;border-top:1px solid #e0e7ef}footer{padding:12px 16px;display:flex;justify-content:space-between;font-size:12px;color:#62748c}aside{padding:22px 32px;background:#fff3d3}.mobile img{max-width:390px;margin:auto}.overview img{height:370px;object-fit:cover;object-position:top}.overview header{padding-top:24px}.overview main{padding-top:4px;gap:16px}.overview footer{display:none}@media(max-width:800px){main{grid-template-columns:1fr;padding:16px}header{padding:22px}h1{font-size:29px}footer{display:block}}`;
const header = `<header><div class="kicker">TECHNOEDGE LEARNING SERVICES • ACTUAL APPLICATION REVIEW</div><h1>TechnoEdge Assessment ROI</h1><p>Accepted corporate workflows, separate Host and Attendee portals, fixed practical challenges and durable storage integration. These are screenshots of the working local application, captured on 7 November 2026 using synthetic accounts.</p><div class="chips"><span>91 unit/integration tests passed</span><span>7 browser scenarios passed</span><span>Production build passed</span><span>25 MiB resumable evidence</span><span class="pending">Live infrastructure pending • no deployment authorized</span></div><div class="actions"><a class="button" href="http://127.0.0.1:3000/login">Open running application ↗</a><a class="button" href="https://github.com/GuruRagvesh/TechnoEdge-ROI-Measurement-Tool">Private GitHub repository ↗</a></div></header>`;
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TechnoEdge — complete application review</title><style>${css}</style>${header}<nav aria-label="Screenshot filters"><button data-filter="all">All screens</button><button data-filter="public">Public pages</button><button data-filter="attendee">Attendee portal</button><button data-filter="host">Host portal</button></nav><main>${screens.filter(s => s.file !== "attendee-mobile").map(view).join("")}<article class="mobile" data-role="attendee"><h2>390px mobile assessment workspace</h2><a href="screenshots/final/attendee-mobile.png"><img src="screenshots/final/attendee-mobile.png" alt="Mobile workspace" loading="lazy"></a></article></main><aside>Local private accounts: DEMO001 (Attendee) and HOST001 (Host), using existing privately configured passwords. No OTP bypass is enabled for normal users. Live SharePoint grants/CORS/concurrency, Resend delivery, protected Vercel staging and the 2 → 10 → larger cohort pilot require separate approvals and verification. Screenshot links use this workspace’s synthetic room IDs and require an appropriate signed-in local account. This review is documentation, not another application or a public deployment.</aside><script>document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>document.querySelectorAll('article').forEach(a=>a.hidden=b.dataset.filter!=='all'&&a.dataset.role!==b.dataset.filter));</script></html>`;
const finalHtml = html.replaceAll("screenshots/final/", "screenshots/");
await writeFile("../final-review/index.html", finalHtml);
const selected = [
  "attendee-dashboard",
  "host-dashboard",
  "attendee-workspace",
  "attendee-comparison",
].map((f) => screens.find((s) => s.file === f));
const overview = `<!doctype html><html><meta charset="utf-8"><style>${css}</style><body class="overview">${header}<main>${selected.map(view).join("")}</main></body></html>`;
await writeFile(
  "../final-review/overview.html",
  overview.replaceAll("screenshots/final/", "screenshots/"),
);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1680, height: 1400 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(resolve("../final-review/overview.html")).href);
  await page
    .locator("img")
    .evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())));
  await page.screenshot({
    path: "../final-review/screenshots/overview.png",
    fullPage: true,
  });
} finally {
  await browser.close();
}
console.log(
  "Complete review HTML and four-screen overview generated from actual local captures.",
);
await mkdir("docs/final-review", { recursive: true });
await cp("../final-review", "docs/final-review", { recursive: true });
console.log(
  "A matching review copy is included under docs/final-review for GitHub.",
);
