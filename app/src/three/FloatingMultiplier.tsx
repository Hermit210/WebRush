import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

/**
 * Floating HUD-style multiplier number that appears near the character in
 * 3D world-space and drifts up/fades on each successful swing -- the
 * reference-video detail called out explicitly in the visual spec ("floating
 * multiplier numbers appear in the 3D space near the character... white/cyan
 * text like '2.5x' ... appearing to hover in 3D space rather than being flat
 * 2D screen overlay"). The main multiplier readout stays the existing flat
 * HTML overlay (spec section A.8); this is a supplementary flourish.
 *
 * Uses drei's <Html> (a real, CSS-transformed DOM element anchored to a 3D
 * position) rather than in-scene WebGL text (`@react-three/drei`'s <Text>,
 * built on troika-three-text's SDF shader). Verified via headless-browser
 * screenshots that <Text> renders zero visible glyphs in this sandbox's
 * SwiftShader software-rendering fallback -- likely an SDF-shader/hardware-
 * derivative-extension gap in software rendering, not necessarily a bug on
 * real hardware, but not confirmable either way without a real GPU. The
 * spec itself explicitly allows "a 3D-positioned OR overlay text element",
 * so this sidesteps the open question rather than shipping something
 * unverified either way.
 */
export function FloatingMultiplier({
  swingIndex,
  label,
  anchorRef,
}: {
  swingIndex: number;
  label: string;
  anchorRef: React.MutableRefObject<THREE.Vector3>;
}) {
  const [popup, setPopup] = useState<{ id: number; label: string } | null>(null);
  const idRef = useRef(0);
  const prevIndexRef = useRef(swingIndex);
  const startRef = useRef(0);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (swingIndex !== prevIndexRef.current && swingIndex > 0) {
      prevIndexRef.current = swingIndex;
      idRef.current += 1;
      startRef.current = performance.now() / 1000;
      setPopup({ id: idRef.current, label });
      const timeout = setTimeout(() => setPopup(null), 1300);
      return () => clearTimeout(timeout);
    }
  }, [swingIndex, label]);

  useFrame(() => {
    if (!popup || !groupRef.current) return;
    const t = Math.min((performance.now() / 1000 - startRef.current) / 1.3, 1);
    const origin = anchorRef.current;
    groupRef.current.position.set(origin.x, origin.y + 1.2 + t * 0.8, origin.z);
    const el = groupRef.current.userData.el as HTMLDivElement | undefined;
    if (el) el.style.opacity = String(1 - t);
  });

  if (!popup) return null;

  return (
    <group ref={groupRef}>
      <Html center distanceFactor={2} occlude={false} zIndexRange={[10, 0]}>
        <div
          className="floating-multiplier-popup"
          ref={(el) => {
            if (groupRef.current) groupRef.current.userData.el = el;
          }}
        >
          {popup.label}
        </div>
      </Html>
    </group>
  );
}
