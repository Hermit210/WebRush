import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Character, type CharacterAnimation } from "./Character";
import { getAnchorPoint } from "./cityLayout";

const SWING_DURATION = 1.6; // seconds per arc -- a tuning knob, not physics

export type SwingPhase = "idle" | "swinging" | "missed" | "cashed_out";

interface SwingRigProps {
  /** Current CONFIRMED on-chain swing_index -- driving this, not a timer,
   * is what ties the animation to real game state (see Scene/InRun). */
  swingIndex: number;
  phase: SwingPhase;
  onPositionUpdate?: (pos: THREE.Vector3, velocity: number) => void;
}

/**
 * Fakes a swing with a scripted quadratic-Bezier arc between two building
 * anchor points (see cityLayout.ts), NOT a rope/pendulum physics sim --
 * per spec section 6, this is the standard game-dev "fake it" technique
 * and reads as convincing at normal camera distance. A real Mixamo/RPM
 * "swinging" clip doesn't exist as stock content either way; this rig
 * plays the closest available baked clip (Jump) across the arc so the
 * character LOOKS like it's swinging even though the motion itself is a
 * scripted curve.
 */
export function SwingRig({ swingIndex, phase, onPositionUpdate }: SwingRigProps) {
  const groupRef = useRef<THREE.Group>(null);
  const lineGeomRef = useRef<THREE.BufferGeometry>(null);
  const fromRef = useRef(new THREE.Vector3(...getAnchorPoint(0)));
  const toRef = useRef(new THREE.Vector3(...getAnchorPoint(0)));
  const startTimeRef = useRef(performance.now() / 1000);
  const prevIndexRef = useRef(swingIndex);
  const fallStartRef = useRef<number | null>(null);
  const positionRef = useRef(new THREE.Vector3(...getAnchorPoint(0)));
  // Scratch vectors reused every frame instead of allocated fresh -- avoids
  // needless GC pressure from the per-frame Bezier math below (found while
  // investigating a low FPS reading during headless verification, see
  // scripts/check-scene.mjs / README 3D section for why that reading itself
  // isn't representative of real hardware).
  const midScratch = useRef(new THREE.Vector3());
  const posScratch = useRef(new THREE.Vector3());

  // Kick off a new arc whenever the confirmed swing_index advances.
  useEffect(() => {
    if (swingIndex !== prevIndexRef.current) {
      fromRef.current.set(...getAnchorPoint(prevIndexRef.current));
      toRef.current.set(...getAnchorPoint(swingIndex));
      startTimeRef.current = performance.now() / 1000;
      prevIndexRef.current = swingIndex;
    }
  }, [swingIndex]);

  useEffect(() => {
    if (phase === "missed" && fallStartRef.current === null) {
      fallStartRef.current = performance.now() / 1000;
    }
    if (phase !== "missed") {
      fallStartRef.current = null;
    }
  }, [phase]);

  const animation: CharacterAnimation =
    phase === "missed" ? "WalkJump" : phase === "swinging" ? "Jump" : "Idle";

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const now = performance.now() / 1000;

    if (phase === "missed" && fallStartRef.current !== null) {
      const t = now - fallStartRef.current;
      const pos = positionRef.current;
      pos.y -= t * t * 6; // simple accelerating drop, not a physics sim
      pos.z += t * 5;
      group.position.copy(pos);
      group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, 0.8, 0.08);
      onPositionUpdate?.(pos, 0);
      return;
    }

    const elapsed = now - startTimeRef.current;
    const t = THREE.MathUtils.clamp(elapsed / SWING_DURATION, 0, 1);
    const eased = THREE.MathUtils.smoothstep(t, 0, 1);

    const from = fromRef.current;
    const to = toRef.current;
    const dist = from.distanceTo(to);
    const mid = midScratch.current.copy(from).lerp(to, 0.5);
    mid.y += Math.max(dist * 0.35, 3);

    const inv = 1 - eased;
    const pos = posScratch.current
      .set(0, 0, 0)
      .addScaledVector(from, inv * inv)
      .addScaledVector(mid, 2 * inv * eased)
      .addScaledVector(to, eased * eased);

    group.position.copy(pos);
    positionRef.current.copy(pos);

    const velocity = t > 0 && t < 1 ? Math.abs(to.x - from.x) * 0.015 : 0;
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, velocity * (to.x > from.x ? -1 : 1), 0.15);
    group.lookAt(to.x, pos.y, to.z);

    onPositionUpdate?.(pos, velocity);

    // Web-line: hand-height point -> anchor, hidden once the arc completes.
    const geom = lineGeomRef.current;
    if (geom) {
      const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
      posAttr.setXYZ(0, pos.x, pos.y + 1.6, pos.z);
      posAttr.setXYZ(1, to.x, to.y, to.z);
      posAttr.needsUpdate = true;
      geom.setDrawRange(0, t < 1 ? 2 : 0);
    }
  });

  return (
    <>
      <group ref={groupRef}>
        <Character animation={animation} scale={1.2} />
      </group>
      <line>
        <bufferGeometry ref={lineGeomRef}>
          <bufferAttribute attach="attributes-position" args={[new Float32Array(6), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#4dd0ff" toneMapped={false} linewidth={2} />
      </line>
    </>
  );
}
