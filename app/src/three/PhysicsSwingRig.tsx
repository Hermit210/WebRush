import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CapsuleCollider, useRopeJoint, type RapierRigidBody } from "@react-three/rapier";
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
 * joint -- react-three-rapier's useRopeJoint creates the joint on mount and
 * removes it on unmount (see @react-three/rapier's useImpulseJoint), so a
 * conditionally-rendered wrapper is the natural way to express "joint
 * exists only while actively swinging" without fighting the rules of hooks.
 *
 * A ROPE joint, not a spherical one (this was the actual bug in the first
 * version of this file -- see PhysicsSwingRig's own doc comment below for
 * the full story): a spherical/ball-and-socket joint forces its two anchor
 * points to be exactly coincident, including at the instant of creation.
 * The character starts near its OWN building, tens of units from the
 * target anchor across the street -- attaching a spherical joint between
 * two points that far apart makes Rapier's solver try to snap them
 * together in a single step, which is a violent, physically-nonsensical
 * correction (the "flying debris" / character-exploding bug). A rope joint
 * only LIMITS the max distance between the two points; as long as `length`
 * is computed as the actual current distance at attach time (see below),
 * the rope starts already taut with zero correction needed, and gravity
 * does the rest -- character falls freely until the rope goes taut, then
 * swings like an actual pendulum around the fixed anchor.
 */
function SwingJoint({
  characterRef,
  targetRef,
  targetLocalAnchor,
  length,
}: {
  characterRef: RefObject<RapierRigidBody>;
  targetRef: RefObject<RapierRigidBody>;
  targetLocalAnchor: THREE.Vector3;
  length: number;
}) {
  useRopeJoint(characterRef, targetRef, [CHARACTER_LOCAL_ANCHOR, targetLocalAnchor, length]);
  return null;
}

/**
 * Real physics-driven swing, replacing SwingRig's scripted Bezier arc
 * during active gameplay (see Scene.tsx -- idle/result presentation still
 * uses the plain scripted SwingRig, which is cheaper and doesn't need
 * physics for a standing-still character).
 *
 * The pendulum motion itself comes entirely from a Rapier rope joint (see
 * SwingJoint's doc comment above for why a rope joint, not a spherical
 * one) plus gravity: attached to the NEXT anchor building the moment
 * `phase` becomes "swinging" (the same optimistic, pre-confirmation
 * trigger the old scripted rig used), released the moment `phase` changes
 * away from that. On a successful landing (phase -> "idle" with a new
 * swingIndex), the character is snapped onto the confirmed exact anchor
 * point -- a small correction, not a teleport across the whole swing,
 * since the physics motion already carried it most of the way there. On a
 * miss (phase -> "missed"), nothing extra happens: the joint is already
 * gone, so gravity and whatever velocity the character already had take
 * over as a real physics fall, not a scripted drop curve.
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
    length: number;
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
      const body = characterRef.current;
      if (targetBody && body) {
        const [bx, by, bz] = getBuildingCenter(targetIndex);
        const [ax, ay, az] = getAnchorPoint(targetIndex);
        const worldAnchor2 = new THREE.Vector3(ax, ay, az);

        // Rope length = the REAL current distance from the character's
        // hand-anchor to the target, read fresh from the rigid body right
        // now -- not a stale precomputed position. This is what makes the
        // rope start already taut (character free-falls until it reaches
        // this exact length, then swings) instead of snapping violently to
        // close a gap, which is what the previous spherical-joint version
        // did wrong (see SwingJoint's doc comment).
        const charPos = body.translation();
        const worldAnchor1 = new THREE.Vector3(
          charPos.x + CHARACTER_LOCAL_ANCHOR.x,
          charPos.y + CHARACTER_LOCAL_ANCHOR.y,
          charPos.z + CHARACTER_LOCAL_ANCHOR.z
        );
        const length = worldAnchor1.distanceTo(worldAnchor2);

        setJointTarget({
          key: targetIndex,
          targetRef: { current: targetBody },
          localAnchor: new THREE.Vector3(ax - bx, ay - by, az - bz),
          length,
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
        linearDamping={0.15}
        angularDamping={0.5}
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
          length={jointTarget.length}
        />
      )}
    </>
  );
}
