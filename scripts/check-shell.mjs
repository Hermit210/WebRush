import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 640 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("http://localhost:5173", { waitUntil: "load" });
await page.waitForTimeout(400);
await page.screenshot({ path: "scripts/shell-1-splash.png" });
const splashText = await page.evaluate(() => document.body.innerText);

// Click to skip the splash rather than waiting out the timer.
await page.click(".splash-screen");
await page.waitForTimeout(400);
await page.screenshot({ path: "scripts/shell-2-menu.png" });
const menuText = await page.evaluate(() => document.body.innerText);

// Click Play while disconnected -- should open the wallet modal contextually.
await page.click("text=Play");
await page.waitForTimeout(400);
await page.screenshot({ path: "scripts/shell-3-play-click.png" });
const afterPlayText = await page.evaluate(() => document.body.innerText);

console.log("=== splash body text ===");
console.log(splashText);
console.log("=== menu body text (no wallet connected) ===");
console.log(menuText);
console.log("=== after clicking Play while disconnected ===");
console.log(afterPlayText);
console.log("=== uncaught page errors ===");
console.log(errors.length === 0 ? "none" : errors);

await browser.close();
