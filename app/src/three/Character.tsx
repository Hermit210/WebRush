import { useEffect, useRef } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import type { Group } from "three";

const MODEL_URL = "/models/RobotExpressive.glb";

/**
 * CC0 1.0 (public domain) rigged character, model by Tomas Laulhe
 * (patreon.com/quaternius), glTF conversion by Don McCurdy -- see
 * public/models/RobotExpressive-LICENSE.txt. Not a custom "web-swinging
 * hero" model (Mixamo/Ready Player Me require an interactive account/export
 * flow that can't be automated here); this is the closest free, directly
 * fetchable, real rigged+animated glTF substitute, recolored below to match
 * WebRush's neon palette. Swap in a real Mixamo/RPM export later by
 * replacing this file and re-checking the animation clip names against
 * scripts read at build time (see README 3D section).
 *
 * Real embedded clip names (verified against the file, not assumed):
 * Dance, Death, Idle, Jump, No, Punch, Running, Sitting, Standing,
 * ThumbsUp, Walking, WalkJump, Wave, Yes.
 */
export type CharacterAnimation = "Idle" | "Jump" | "WalkJump" | "Running";

export function Character({
  animation = "Idle",
  ...props
}: { animation?: CharacterAnimation } & JSX.IntrinsicElements["group"]) {
  const group = useRef<Group>(null);
  const { scene, animations } = useGLTF(MODEL_URL);
  const { actions } = useAnimations(animations, group);

  // Recolor: dark navy body + emissive cyan trim (the "Main" material),
  // small magenta accent on "Grey" -- matches the existing 2D UI palette in
  // styles.css (--accent: #4dd0ff, --accent-2: #ff5da2) rather than the
  // robot's default plastic-toy colors.
  useEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat) return;
      if (mat.name === "Main") {
        mat.color = new THREE.Color("#0b0e1a");
        mat.emissive = new THREE.Color("#4dd0ff");
        mat.emissiveIntensity = 1.4;
        mat.metalness = 0.7;
        mat.roughness = 0.25;
      } else if (mat.name === "Grey") {
        mat.color = new THREE.Color("#141a2e");
        mat.emissive = new THREE.Color("#ff5da2");
        mat.emissiveIntensity = 0.5;
        mat.metalness = 0.5;
        mat.roughness = 0.4;
      } else if (mat.name === "Black") {
        mat.color = new THREE.Color("#05060c");
        mat.metalness = 0.3;
        mat.roughness = 0.6;
      }
    });
  }, [scene]);

  useEffect(() => {
    const action = actions[animation];
    action?.reset().fadeIn(0.3).play();
    return () => {
      action?.fadeOut(0.3);
    };
  }, [animation, actions]);

  return <primitive ref={group} object={scene} {...props} />;
}

useGLTF.preload(MODEL_URL);
