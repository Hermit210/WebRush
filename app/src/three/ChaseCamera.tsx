import { useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

interface ChaseCameraProps {
  targetRef: MutableRefObject<THREE.Vector3>;
  velocityRef?: MutableRefObject<number>;
}

// Behind + above the character, looking down the swing path -- a fixed
// chase cam reads as "gameplay"; an orbit controller reads as "viewer/demo"
// per spec section 7, so this deliberately does NOT use OrbitControls.
// Pulled back further than an initial pass (0,4,9) -- that framed so tight
// the character filled the whole screen with no city visible at all
// (confirmed visually via scripts/check-scene.mjs screenshots, not just
// guessed at).
const OFFSET = new THREE.Vector3(0, 9, 20);

export function ChaseCamera({ targetRef, velocityRef }: ChaseCameraProps) {
  const camRef = useRef<THREE.PerspectiveCamera>(null);
  const shake = useRef(0);
  const desiredScratch = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const cam = camRef.current;
    if (!cam) return;
    const target = targetRef.current;
    const desired = desiredScratch.current.copy(target).add(OFFSET);

    // Subtle bank/shake tied to swing velocity, kept low-amplitude --
    // overdoing this is a real motion-sickness risk per spec section 7.
    const vel = velocityRef?.current ?? 0;
    shake.current = THREE.MathUtils.lerp(shake.current, vel, 0.1);
    desired.x += Math.sin(performance.now() / 130) * shake.current * 0.4;
    desired.y += Math.cos(performance.now() / 170) * shake.current * 0.2;

    const lerpFactor = 1 - Math.pow(0.001, delta);
    cam.position.lerp(desired, lerpFactor);
    cam.lookAt(target.x, target.y + 1, target.z - 4);
    cam.rotation.z = THREE.MathUtils.lerp(cam.rotation.z, -shake.current * 0.05, 0.1);
  });

  return <PerspectiveCamera ref={camRef} makeDefault fov={60} position={[0, 9, 20]} />;
}
