import { useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
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
//
// No view-offset framing trick here (there used to be one, to dodge a big
// centered menu card) -- the menu UI is now two small corner/edge panels
// (see Lobby.tsx's .menu-hud-panel / .menu-play-dock), not a center-screen
// card, so the character can just be centered as the dominant visual.
const RADIUS = 24;
const BASE_HEIGHT = 10;
const ANGLE_SPEED = 0.045; // rad/s -- a full loop takes ~140s, ambient not dizzying

export function IdleCamera({ focusRef }: IdleCameraProps) {
  const camRef = useRef<THREE.PerspectiveCamera>(null);
  const t0 = useRef(performance.now());

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
