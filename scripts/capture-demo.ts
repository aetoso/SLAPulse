/**
 * One-off script to capture README/marketing screenshots (and video frames)
 * of the local app. Not part of the runtime app. Run with:
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
  const adminBtn = await page.$x?.("//button[contains(., 'Admin')]");
  // Fallback: use evaluate to click by text since $x may not exist in this puppeteer version
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

  // 4. Monitor detail: beta-inc-app (SSL + response time)
  await page.goto(`${BASE}/monitors/beta-inc-app`, { waitUntil: "networkidle0" });
  await shot(page, "04-monitor-detail-ssl");

  // 5. AWS Evidence page
  await page.goto(`${BASE}/evidence?customerId=beta-inc`, { waitUntil: "networkidle0" });
  await shot(page, "05-evidence");

  // 6. Dashboard
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0" });
  await shot(page, "06-dashboard");

  // 7. Executive portfolio
  await page.goto(`${BASE}/executive`, { waitUntil: "networkidle0" });
  await shot(page, "07-executive");

  // 8. Trust Portal login
  await page.goto(`${BASE}/portal/acme-saas-co/login`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => {
    const sel = document.querySelector("select") as HTMLSelectElement | null;
    return !!sel && sel.options.length > 0 && !!sel.value;
  });
  await shot(page, "08-portal-login");

  // Request link & follow it
  await page.type('input[type="email"]', "it-director@betainc.com", { delay: 20 });
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find((el) => el.textContent?.includes("Send sign-in link"));
    (b as HTMLButtonElement)?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes("Local dev: no real email"), { timeout: 5000 }).catch(() => {});

  const link = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll("a")).find((el) => el.href.includes("/portal/") && el.href.includes("verify"));
    if (a) return a.href;
    const match = document.body.innerText.match(/http:\/\/localhost:3000\/portal\/[^\s]*verify\?token=[a-f0-9]+/);
    return match ? match[0] : null;
  });

  if (link) {
    await page.goto(link, { waitUntil: "networkidle0" });
    await shot(page, "09-portal-dashboard");
  }

  // 10. Public status page
  await page.goto(`${BASE}/status/acme-saas-co`, { waitUntil: "networkidle0" });
  await shot(page, "10-public-status");

  await browser.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
