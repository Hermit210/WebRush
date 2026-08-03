import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Physics, type RapierRigidBody } from "@react-three/rapier";
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from "@react-three/postprocessing";
import * as THREE from "three";
import { City } from "./City";
import { BuildingColliders } from "./BuildingColliders";
import { SwingRig, type SwingPhase } from "./SwingRig";
import { PhysicsSwingRig } from "./PhysicsSwingRig";
import { ChaseCamera } from "./ChaseCamera";
import { IdleCamera } from "./IdleCamera";
import { getAnchorPoint, MAX_ANCHOR_INDEX } from "./cityLayout";
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
  // Populated by <BuildingColliders>, indexed by the same swing_index
  // addressing getAnchorPoint uses -- lets PhysicsSwingRig look up "the
  // rigid body for anchor index N" when attaching a swing joint.
  const buildingBodies = useRef<(RapierRigidBody | null)[]>(
    new Array(MAX_ANCHOR_INDEX + 1).fill(null)
  );

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
        {isIdlePresentation ? (
          // Idle/result presentation: the plain scripted rig, standing
          // still and playing its Idle clip -- no <Physics> world at all
          // here, since nothing dynamic is happening and a standing
          // character doesn't need simulation (see PhysicsSwingRig.tsx doc
          // comment for why active gameplay does).
          <SwingRig
            swingIndex={0}
            phase="idle"
            onPositionUpdate={(p, v) => {
              characterPos.current.copy(p);
              velocity.current = v;
            }}
          />
        ) : (
          <Physics>
            <BuildingColliders bodiesRef={buildingBodies} />
            <PhysicsSwingRig
              swingIndex={swingIndex}
              phase={phase}
              buildingBodies={buildingBodies}
              onPositionUpdate={(p, v) => {
                characterPos.current.copy(p);
                velocity.current = v;
              }}
            />
          </Physics>
        )}
      </Suspense>

      {isIdlePresentation ? (
        <IdleCamera focusRef={characterPos} />
      ) : (
        <ChaseCamera targetRef={characterPos} velocityRef={velocity} />
      )}

      {!isIdlePresentation && (
        <>
          <FloatingMultiplier
            key={`fm-${runId}`}
            swingIndex={swingIndex}
            label={`${multiplierAt(swingIndex).toFixed(2)}x`}
            anchorRef={characterPos}
          />
          <PeakMultiplierBadge key={`badge-${runId}`} swingIndex={swingIndex} anchorRef={characterPos} />
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
