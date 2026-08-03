import { useMemo, type MutableRefObject } from "react";
import { RigidBody, CuboidCollider, type RapierRigidBody } from "@react-three/rapier";
import { generateCityLayout } from "./cityLayout";

/**
 * Invisible physics-only colliders matching City.tsx's visual buildings --
 * deliberately a separate component rather than folding physics into
 * City.tsx itself, so the purely-visual idle-preview rendering path stays
 * completely untouched (no <Physics> cost there at all, only active
 * gameplay pays for this -- see Scene.tsx).
 *
 * Simple box colliders, not trimesh -- the buildings are visually boxes
 * too, so a trimesh would cost more to simulate for zero visual gain.
 *
 * `bodiesRef` is populated (indexed by the same swing_index addressing
 * `cityLayout.ts`'s `getAnchorPoint` uses) so PhysicsSwingRig can look up
 * "the rigid body for anchor index N" directly when attaching a swing
 * joint to it.
 */
export function BuildingColliders({
  bodiesRef,
}: {
  bodiesRef: MutableRefObject<(RapierRigidBody | null)[]>;
}) {
  const buildings = useMemo(() => generateCityLayout(), []);

  return (
    <>
      {buildings.map((b) => {
        const anchorIndex = b.side === "left" ? b.index * 2 : b.index * 2 + 1;
        return (
          <RigidBody
            key={`${b.side}-${b.index}`}
            type="fixed"
            colliders={false}
            position={[b.x, b.height / 2, b.z]}
            ref={(body) => {
              bodiesRef.current[anchorIndex] = body;
            }}
          >
            <CuboidCollider args={[b.width / 2, b.height / 2, b.depth / 2]} />
          </RigidBody>
        );
      })}
    </>
  );
}
