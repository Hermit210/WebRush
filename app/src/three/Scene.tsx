import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from "@react-three/postprocessing";
import * as THREE from "three";
import { City } from "./City";
import { SwingRig, type SwingPhase } from "./SwingRig";
import { ChaseCamera } from "./ChaseCamera";
import { IdleCamera } from "./IdleCamera";
import { getAnchorPoint } from "./cityLayout";
import { FloatingMultiplier } from "./FloatingMultiplier";
import { PeakMultiplierBadge } from "./PeakMultiplierBadge";
import { multiplierAt } from "../anchor/constants";

/** 'idle' (menu, or between runs on the result screen) presents the
 * character standing/idling with an ambient orbiting camera and no HUD
 * elements -- a cosmetic preview loop, not tied to real game state. 'active'
 * is real gameplay: on-chain swingIndex/phase drive the swing arcs, chase
 * cam, and HUD numbers. See README "3D idle preview" for the full reasoning. */
export type GamePhase = "idle" | "active" | "result";

/**
 * The 3D visual layer. Mounted continuously from the menu screen onward
 * (see App.tsx) rather than only during a run -- `gamePhase` is a pure
 * display-mode switch (idle preview vs live gameplay), not a remount, so
 * there's no reload/flash when Play is clicked.
 *
 * The neon look leans entirely on dark ambient + emissive materials +
 * Bloom, not geometry detail, per spec section 5 -- that's the piece most
 * worth tuning if this doesn't read as "neon" enough.
 */
export function Scene({
  swingIndex,
  phase,
  gamePhase,
  runId,
}: {
  swingIndex: number;
  phase: SwingPhase;
  gamePhase: GamePhase;
  /** Bumped once per new run so FloatingMultiplier/PeakMultiplierBadge's
   * internal "already shown this milestone" state resets on replay --
   * everything else (SwingRig, City, camera) stays mounted across runs. */
  runId: number;
}) {
  const characterPos = useRef(new THREE.Vector3(...getAnchorPoint(0)));
  const velocity = useRef(0);
  const isIdlePresentation = gamePhase !== "active";
  // Forced to a fixed resting pose during idle/result -- this is a cosmetic
  // preview loop, not tied to real game state (see GamePhase doc comment).
  const effectiveSwingIndex = isIdlePresentation ? 0 : swingIndex;
  const effectivePhase: SwingPhase = isIdlePresentation ? "idle" : phase;

  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      shadows={false}
    >
      <color attach="background" args={["#05060c"]} />
      <fog attach="fog" args={["#05060c", 40, 170]} />

      {/* Dark ambient + a single dim directional "moonlight" -- real-time
          shadows are intentionally skipped (expensive), depth instead
          comes from fog + emissive glow (spec section 9 perf guardrail). */}
      <ambientLight intensity={0.32} color="#1b2242" />
      <directionalLight position={[15, 40, 10]} intensity={0.55} color="#4dd0ff" />

      <Suspense fallback={null}>
        <City />
        <SwingRig
          swingIndex={effectiveSwingIndex}
          phase={effectivePhase}
          onPositionUpdate={(p, v) => {
            characterPos.current.copy(p);
            velocity.current = v;
          }}
        />
      </Suspense>

      {isIdlePresentation ? (
        <IdleCamera focusRef={characterPos} />
      ) : (
        <ChaseCamera targetRef={characterPos} velocityRef={velocity} />
      )}

      {!isIdlePresentation && (
        <>
          <FloatingMultiplier
            key={runId}
            swingIndex={effectiveSwingIndex}
            label={`${multiplierAt(effectiveSwingIndex).toFixed(2)}x`}
            anchorRef={characterPos}
          />
          <PeakMultiplierBadge key={runId} swingIndex={effectiveSwingIndex} anchorRef={characterPos} />
        </>
      )}

      <EffectComposer>
        <Bloom
          intensity={1.15}
          luminanceThreshold={0.15}
          luminanceSmoothing={0.4}
          mipmapBlur
        />
        <ChromaticAberration
          offset={new THREE.Vector2(0.0006, 0.0006)}
          radialModulation={false}
          modulationOffset={0}
        />
        <Vignette eskil={false} offset={0.25} darkness={0.6} />
      </EffectComposer>
    </Canvas>
  );
}
