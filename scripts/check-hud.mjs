import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });

const pageErrors = [];
const consoleMessages = [];
page.on("pageerror", (err) => pageErrors.push(err.message));
page.on("console", (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
page.on("requestfailed", (req) => consoleMessages.push(`[requestfailed] ${req.url()} -- ${req.failure()?.errorText}`));

await page.goto("http://localhost:5173/scene-debug.html", { waitUntil: "load" });

// Debug harness ticks every 1800ms. Wait 1800+400ms after each tick to catch
// the floating popup mid-flight (visible window ~1.3s), landing consistently
// ~400ms after each new swing fires.
for (let tick = 1; tick <= 5; tick++) {
  await page.waitForTimeout(tick === 1 ? 2200 : 1800);
  const status = await page.evaluate(
    () => document.querySelector('[data-testid="scene-debug-status"]')?.textContent
  );
  await page.screenshot({ path: `scripts/hud-tick-${tick}.png` });
  console.log(`tick ${tick} -- ${status}`);
}

console.log("=== uncaught page errors ===");
pageErrors.forEach((e) => console.log(e));
console.log(pageErrors.length === 0 ? "(none)" : "");
console.log("=== console messages ===");
consoleMessages.forEach((m) => console.log(m));

await browser.close();
