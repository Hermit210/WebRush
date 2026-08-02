import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 640 } });

const consoleMessages = [];
const pageErrors = [];
page.on("console", (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => pageErrors.push(err.message));

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const bodyText = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: "scripts/main-landing-screenshot.png" });

await page.click("text=Select Wallet");
await page.waitForTimeout(500);
const modalText = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: "scripts/main-wallet-modal-screenshot.png" });

console.log("=== body text (landing) ===");
console.log(bodyText || "(empty)");
console.log("=== body text (after clicking Select Wallet) ===");
console.log(modalText || "(empty)");
console.log("=== console messages ===");
consoleMessages.forEach((m) => console.log(m));
console.log("=== uncaught page errors ===");
pageErrors.forEach((e) => console.log(e));
console.log("=== screenshot saved ===");

await browser.close();
