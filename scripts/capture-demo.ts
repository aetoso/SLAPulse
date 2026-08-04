/**
 * One-off script to capture README/marketing screenshots of the local
 * app. Not part of the runtime app. Run with:
 *   npx tsx scripts/capture-demo.ts
 */
import puppeteer from "puppeteer";
import path from "node:path";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "..", "docs", "screenshots");
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

async function shot(page: import("puppeteer").Page, name: string) {
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, `${name}.png`) as `${string}.png` });
  console.log("captured", name);
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, defaultViewport: VIEWPORT });
  const page = await browser.newPage();

  // 1. Sign-in screen
  await page.goto(`${BASE}/monitors`, { waitUntil: "networkidle0" });
  await shot(page, "01-signin");

  // Click Admin role button
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find((el) => el.textContent?.includes("Admin"));
    (b as HTMLButtonElement)?.click();
  });
  await page.waitForNetworkIdle({ idleTime: 500 }).catch(() => {});
  await shot(page, "02-monitors-list");

  // 3. Monitor detail: broken endpoint (dramatic real failure)
  await page.goto(`${BASE}/monitors/broken-endpoint-demo`, { waitUntil: "networkidle0" });
  await shot(page, "03-monitor-detail-broken");

  // 4. Monitor detail: main app (SSL + response time)
  await page.goto(`${BASE}/monitors/beta-inc-app`, { waitUntil: "networkidle0" });
  await shot(page, "04-monitor-detail-ssl");

  // 5. AWS Integration wizard
  await page.goto(`${BASE}/aws-integration`, { waitUntil: "networkidle0" });
  await shot(page, "05-aws-integration");

  // 6. Public status page
  await page.goto(`${BASE}/status/acme-saas-co`, { waitUntil: "networkidle0" });
  await shot(page, "06-public-status");

  await browser.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
