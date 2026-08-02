import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 640 } });
const errors = [];
const audioRequests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (req) => {
  if (req.url().includes("/audio/")) audioRequests.push(req.url());
});

await page.goto("http://localhost:5173", { waitUntil: "load" });
await page.waitForTimeout(200);
// Skip splash
await page.click(".splash-screen", { timeout: 2000 }).catch(() => {});
await page.waitForTimeout(300);

// Click Play -- should fire the "click" sound cue (autoplay may still be
// blocked pre-gesture, but the request for the audio file itself, and no
// thrown error, confirms the wiring is correct).
await page.click("text=Play");
await page.waitForTimeout(500);

console.log("=== audio file requests seen ===");
console.log(audioRequests.length === 0 ? "NONE -- sound cue did not fire" : audioRequests);
console.log("=== uncaught page errors ===");
console.log(errors.length === 0 ? "none" : errors);

await browser.close();
