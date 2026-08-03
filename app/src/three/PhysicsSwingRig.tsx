import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CapsuleCollider, useSphericalJoint, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { Character, type CharacterAnimation } from "./Character";
import { getAnchorPoint, getBuildingCenter, getRestingPoint, MAX_ANCHOR_INDEX } from "./cityLayout";
import type { SwingPhase } from "./SwingRig";

interface PhysicsSwingRigProps {
  swingIndex: number;
  phase: SwingPhase;
  /** Populated by <BuildingColliders>, indexed by the same swing_index
   * addressing as getAnchorPoint. */
  buildingBodies: MutableRefObject<(RapierRigidBody | null)[]>;
  onPositionUpdate?: (pos: THREE.Vector3, velocity: number) => void;
}

// Roughly hand height on the capsule -- where a swing web/rope would
// actually attach, not the body's center of mass.
const CHARACTER_LOCAL_ANCHOR = new THREE.Vector3(0, 0.6, 0);

/**
 * Mounting/unmounting this is literally what attaches/releases the swing
 * joint -- react-three-rapier's useSphericalJoint creates the joint on
 * mount and removes it on unmount (see @react-three/rapier's
 * useImpulseJoint), so a conditionally-rendered wrapper is the natural way
 * to express "joint exists only while actively swinging" without fighting
 * the rules of hooks.
 */
function SwingJoint({
  characterRef,
  targetRef,
  targetLocalAnchor,
}: {
  characterRef: RefObject<RapierRigidBody>;
  targetRef: RefObject<RapierRigidBody>;
  targetLocalAnchor: THREE.Vector3;
}) {
  useSphericalJoint(characterRef, targetRef, [CHARACTER_LOCAL_ANCHOR, targetLocalAnchor]);
  return null;
}

/**
 * Real physics-driven swing, replacing SwingRig's scripted Bezier arc
 * during active gameplay (see Scene.tsx -- idle/result presentation still
 * uses the plain scripted SwingRig, which is cheaper and doesn't need
 * physics for a standing-still character).
 *
 * The pendulum motion itself comes entirely from a Rapier spherical joint
 * (a ball-and-socket constraint -- "typically used to simulate ragdoll
 * arms, pendulums, etc." per react-three-rapier's own docs) plus gravity:
 * attached to the NEXT anchor building the moment `phase` becomes
 * "swinging" (the same optimistic, pre-confirmation trigger the old
 * scripted rig used), released the moment `phase` changes away from that.
 * On a successful landing (phase -> "idle" with a new swingIndex), the
 * character is snapped onto the confirmed exact anchor point -- a small
 * correction, not a teleport across the whole swing, since the physics
 * motion already carried it most of the way there. On a miss (phase ->
 * "missed"), nothing extra happens: the joint is already gone, so gravity
 * and whatever velocity the character already had take over as a real
 * physics fall, not a scripted drop curve.
 */
export function PhysicsSwingRig({
  swingIndex,
  phase,
  buildingBodies,
  onPositionUpdate,
}: PhysicsSwingRigProps) {
  const characterRef = useRef<RapierRigidBody>(null);
  const landedIndexRef = useRef(swingIndex);
  const [jointTarget, setJointTarget] = useState<{
    key: number;
    targetRef: RefObject<RapierRigidBody>;
    localAnchor: THREE.Vector3;
  } | null>(null);

  // Snap to the correct starting anchor exactly once, when this rig first
  // mounts (Scene.tsx only mounts it for the duration of active gameplay).
  useEffect(() => {
    const body = characterRef.current;
    if (!body) return;
    const [x, y, z] = getRestingPoint(swingIndex);
    body.setTranslation({ x, y: y + 1, z }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase === "swinging") {
      const targetIndex = Math.min(swingIndex + 1, MAX_ANCHOR_INDEX);
      const targetBody = buildingBodies.current[targetIndex];
      if (targetBody) {
        const [bx, by, bz] = getBuildingCenter(targetIndex);
        const [ax, ay, az] = getAnchorPoint(targetIndex);
        setJointTarget({
          key: targetIndex,
          targetRef: { current: targetBody },
          localAnchor: new THREE.Vector3(ax - bx, ay - by, az - bz),
        });
      }
      return;
    }

    // Any other phase releases the joint (unmounting <SwingJoint> below).
    setJointTarget(null);

    if (phase === "idle" && swingIndex !== landedIndexRef.current) {
      const body = characterRef.current;
      if (body) {
        const [x, y, z] = getRestingPoint(swingIndex);
        body.setTranslation({ x, y: y + 1, z }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      landedIndexRef.current = swingIndex;
    }
    // phase === "missed": deliberately no correction here -- see doc comment above.
  }, [phase, swingIndex, buildingBodies]);

  const animation: CharacterAnimation =
    phase === "missed" ? "WalkJump" : phase === "swinging" ? "Jump" : "Idle";

  useFrame(() => {
    const body = characterRef.current;
    if (!body) return;
    const t = body.translation();
    const v = body.linvel();
    const speed = Math.hypot(v.x, v.z);
    onPositionUpdate?.(new THREE.Vector3(t.x, t.y, t.z), speed * 0.15);
  });

  return (
    <>
      <RigidBody
        ref={characterRef}
        colliders={false}
        type="dynamic"
        position={getRestingPoint(swingIndex)}
        enabledRotations={[false, false, false]}
        ccd
      >
        <CapsuleCollider args={[0.5, 0.4]} />
        <Character animation={animation} scale={1.2} />
      </RigidBody>
      {jointTarget && (
        <SwingJoint
          key={jointTarget.key}
          characterRef={characterRef}
          targetRef={jointTarget.targetRef}
          targetLocalAnchor={jointTarget.localAnchor}
        />
      )}
    </>
  );
}
