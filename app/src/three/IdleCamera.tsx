import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

interface IdleCameraProps {
  focusRef: MutableRefObject<THREE.Vector3>;
}

// Slow autonomous orbit around the character's resting spot -- deliberately
// NOT OrbitControls (no user input) and NOT a static locked shot (reads as
// "broken/frozen" per the menu-preview spec). Radius/height/angle-speed are
// all offset by independent, non-multiple periods so the loop never repeats
// in a way that reads as mechanical.
const RADIUS = 24;
const BASE_HEIGHT = 10;
const ANGLE_SPEED = 0.045; // rad/s -- a full loop takes ~140s, ambient not dizzying

export function IdleCamera({ focusRef }: IdleCameraProps) {
  const camRef = useRef<THREE.PerspectiveCamera>(null);
  const t0 = useRef(performance.now());
  const { size } = useThree();

  // The menu/result overlay card sits centered on top of this canvas (see
  // App.tsx's .stage-overlay) -- without this, the camera looks straight at
  // the character, which lands it dead-center, exactly where the card
  // covers it. An asymmetric view offset keeps the look-at target (the
  // character) unchanged but shifts where it renders on screen, toward the
  // lower-right where the card doesn't reach, so the idling character is
  // actually visible instead of hidden behind the panel.
  useEffect(() => {
    const cam = camRef.current;
    if (!cam || !size.width || !size.height) return;
    cam.setViewOffset(size.width, size.height, -size.width * 0.3, -size.height * 0.22, size.width, size.height);
    cam.updateProjectionMatrix();
  }, [size]);

  useFrame(() => {
    const cam = camRef.current;
    if (!cam) return;
    const focus = focusRef.current;
    const elapsed = (performance.now() - t0.current) / 1000;

    const angle = elapsed * ANGLE_SPEED;
    const height = BASE_HEIGHT + Math.sin(elapsed * 0.12) * 2.5;
    const radius = RADIUS + Math.sin(elapsed * 0.07) * 3;

    cam.position.set(
      focus.x + Math.cos(angle) * radius,
      focus.y + height,
      focus.z + Math.sin(angle) * radius
    );
    cam.lookAt(focus.x, focus.y + 1.5, focus.z);
  });

  return <PerspectiveCamera ref={camRef} makeDefault fov={55} position={[RADIUS, BASE_HEIGHT, 0]} />;
}
