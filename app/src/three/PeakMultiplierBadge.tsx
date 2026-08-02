import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { MULTIPLIER_TABLE_X100 } from "../anchor/constants";

// Milestone multipliers (in "x" units) that trigger the big celebratory
// moment -- matches the reference video's "10.0x" gold holographic-ring
// beat, described as appearing at a peak-multiplier moment, not on every
// single swing.
const MILESTONES = [5, 10, 15, 20];

/**
 * Gold holographic radar-ring + badge readout, shown briefly when a swing
 * crosses one of the milestone thresholds above. A stylized approximation
 * of the reference video's "big number" moment -- a rotating ring
 * (annulus) standing in for the tick-marked radar/target-lock circle, and
 * a glowing outlined multiplier badge next to it.
 *
 * The ring/tick-marks are plain WebGL geometry (unaffected by the SDF-text
 * rendering gap noted in FloatingMultiplier.tsx); only the numeric badge
 * text uses drei's <Html> for the same reason described there.
 */
export function PeakMultiplierBadge({
  swingIndex,
  anchorRef,
}: {
  swingIndex: number;
  anchorRef: React.MutableRefObject<THREE.Vector3>;
}) {
  const crossedRef = useRef(new Set<number>());
  const [active, setActive] = useState<{ label: string } | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const valueX100 = MULTIPLIER_TABLE_X100[swingIndex] ?? 0;
    for (const milestone of MILESTONES) {
      if (valueX100 >= milestone * 100 && !crossedRef.current.has(milestone)) {
        crossedRef.current.add(milestone);
        setActive({ label: `${milestone.toFixed(1)}x` });
        const timeout = setTimeout(() => setActive(null), 2000);
        return () => clearTimeout(timeout);
      }
    }
  }, [swingIndex]);

  useFrame((_, delta) => {
    if (!active || !groupRef.current) return;
    const origin = anchorRef.current;
    groupRef.current.position.set(origin.x, origin.y + 1.6, origin.z - 1.5);
    if (ringRef.current) ringRef.current.rotation.z += delta * 0.6;
  });

  if (!active) return null;

  return (
    <group ref={groupRef}>
      <mesh ref={ringRef}>
        <ringGeometry args={[1.1, 1.3, 48]} />
        <meshStandardMaterial
          color="#ffd166"
          emissive="#ffd166"
          emissiveIntensity={2.5}
          toneMapped={false}
          side={THREE.DoubleSide}
          transparent
          opacity={0.85}
        />
      </mesh>
      {/* Tick marks around the ring rim, sci-fi radar-dial style */}
      {Array.from({ length: 16 }).map((_, i) => {
        const angle = (i / 16) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[Math.cos(angle) * 1.35, Math.sin(angle) * 1.35, 0]}
            rotation={[0, 0, angle]}
          >
            <planeGeometry args={[0.06, 0.14]} />
            <meshStandardMaterial
              color="#ffd166"
              emissive="#ffd166"
              emissiveIntensity={2}
              toneMapped={false}
            />
          </mesh>
        );
      })}
      <Html position={[1.9, 0, 0]} center distanceFactor={2} occlude={false} zIndexRange={[10, 0]}>
        <div className="peak-multiplier-badge">{active.label}</div>
      </Html>
    </group>
  );
}
