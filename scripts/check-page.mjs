import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();

const consoleMessages = [];
const pageErrors = [];
page.on("console", (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => pageErrors.push(err.message));

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const bodyText = await page.evaluate(() => document.body.innerText);
const hasConnectButton = await page.evaluate(() =>
  !!document.querySelector("button")
);

console.log("=== Body text ===");
console.log(bodyText || "(empty)");
console.log("=== Has any <button> ===", hasConnectButton);
console.log("=== Console messages ===");
consoleMessages.forEach((m) => console.log(m));
console.log("=== Uncaught page errors ===");
pageErrors.forEach((e) => console.log(e));

await browser.close();
