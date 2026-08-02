/**
 * Dev-only isolated entry point for verifying the 3D layer renders without
 * needing a connected wallet (the real app gates <Scene> behind
 * connect -> lobby -> start_run). Not part of the production build's
 * routing -- reachable only by directly requesting scene-debug.html from
 * the Vite dev server. Cycles through swing indices/phases on a timer so a
 * headless check can observe multiple states.
 */
import "./polyfills";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { Scene } from "./three/Scene";
import type { SwingPhase } from "./three/SwingRig";

function DebugHarness() {
  const [swingIndex, setSwingIndex] = useState(0);
  const [phase, setPhase] = useState<SwingPhase>("idle");

  useEffect(() => {
    let i = 0;
    // Goes up to 9 so it actually crosses the 5x (~index 7) and 10x
    // (~index 9) milestones, exercising FloatingMultiplier/PeakMultiplierBadge.
    const id = setInterval(() => {
      i += 1;
      setPhase("swinging");
      setSwingIndex(Math.min(i, 9));
      setTimeout(() => setPhase("idle"), 1200);
      if (i >= 9) clearInterval(id);
    }, 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh" }} data-testid="scene-debug-root">
      <Scene swingIndex={swingIndex} phase={phase} />
      <div
        data-testid="scene-debug-status"
        style={{ position: "absolute", top: 8, left: 8, color: "#4dd0ff", fontFamily: "monospace" }}
      >
        swingIndex={swingIndex} phase={phase}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("scene-root")!).render(
  <React.StrictMode>
    <DebugHarness />
  </React.StrictMode>
);
