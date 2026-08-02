import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from "@react-three/postprocessing";
import * as THREE from "three";
import { City } from "./City";
import { SwingRig, type SwingPhase } from "./SwingRig";
import { ChaseCamera } from "./ChaseCamera";
import { getAnchorPoint } from "./cityLayout";

/**
 * The 3D visual layer. Pure rendering swap over the existing 2D <Skyline>
 * canvas -- takes the same swingIndex/phase data the 2D version already
 * derives from on-chain state (see InRun.tsx), no new game logic here.
 *
 * The neon look leans entirely on dark ambient + emissive materials +
 * Bloom, not geometry detail, per spec section 5 -- that's the piece most
 * worth tuning if this doesn't read as "neon" enough.
 */
export function Scene({
  swingIndex,
  phase,
}: {
  swingIndex: number;
  phase: SwingPhase;
}) {
  const characterPos = useRef(new THREE.Vector3(...getAnchorPoint(0)));
  const velocity = useRef(0);

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
          swingIndex={swingIndex}
          phase={phase}
          onPositionUpdate={(p, v) => {
            characterPos.current.copy(p);
            velocity.current = v;
          }}
        />
      </Suspense>

      <ChaseCamera targetRef={characterPos} velocityRef={velocity} />

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
