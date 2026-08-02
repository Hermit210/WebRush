import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });

const consoleMessages = [];
const pageErrors = [];
page.on("console", (msg) => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => pageErrors.push(err.message));

await page.goto("http://localhost:5173/scene-debug.html", { waitUntil: "load" });
await page.waitForTimeout(2500);

const rendererInfo = await page.evaluate(() => {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!gl) return "no-webgl";
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return ext
    ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
});

const canvasCount = await page.evaluate(() => document.querySelectorAll("canvas").length);
const statusText = await page.evaluate(
  () => document.querySelector('[data-testid="scene-debug-status"]')?.textContent ?? "(missing)"
);

// Sample a pixel from the middle of the canvas to confirm something was
// actually drawn (not just a blank/black canvas from a silent WebGL failure).
const pixelSample = await page.evaluate(() => {
  const canvas = document.querySelector("canvas");
  if (!canvas) return null;
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!gl) return "no-webgl-context";
  const pixels = new Uint8Array(4);
  gl.readPixels(
    Math.floor(canvas.width / 2),
    Math.floor(canvas.height / 2),
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels
  );
  return Array.from(pixels);
});

const fps = await page.evaluate(() => {
  return new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    function tick() {
      frames += 1;
      if (performance.now() - start < 2000) {
        requestAnimationFrame(tick);
      } else {
        resolve(Math.round((frames / (performance.now() - start)) * 1000));
      }
    }
    requestAnimationFrame(tick);
  });
});

await page.screenshot({ path: "scripts/scene-debug-screenshot.png" });

console.log("=== WebGL renderer ===", rendererInfo);
console.log("=== measured FPS (rAF-based, 2s sample) ===", fps);
console.log("=== canvas element count ===", canvasCount);
console.log("=== debug status text ===", statusText);
console.log("=== center pixel RGBA ===", pixelSample);
console.log("=== console messages ===");
consoleMessages.forEach((m) => console.log(m));
console.log("=== uncaught page errors ===");
pageErrors.forEach((e) => console.log(e));
console.log("=== screenshot saved to scripts/scene-debug-screenshot.png ===");

await browser.close();
