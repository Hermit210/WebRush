/**
 * Pure, deterministic city layout data -- no JSX here, so both <City> and
 * the swing-arc controller can derive the exact same building positions
 * and anchor points without needing to measure rendered meshes at runtime.
 *
 * Procedural boxes, not a hand-modeled/asset-pack skyline, per the "don't
 * spend time hunting for a perfect city asset pack" guidance -- the neon
 * look comes from lighting/emissive materials (Character.tsx, Scene.tsx),
 * not geometric detail here.
 */

export interface BuildingSpec {
  side: "left" | "right";
  index: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  signageColor: string;
}

const PATH_SPACING = 14;
const STREET_HALF_WIDTH = 8;
// 11 buildings/side * 2 sides = 22 anchors (indices 0..21), comfortably
// covering MAX_SWING_INDEX=20 from the on-chain constants (0..20 inclusive).
const BUILDINGS_PER_SIDE = 11;
const SIGNAGE_PALETTE = ["#4dd0ff", "#ff5da2", "#ffd166"];

// Cheap seeded PRNG (sine-hash) so layout is stable across re-renders/HMR
// without needing to store random state anywhere.
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

let cached: BuildingSpec[] | null = null;

export function generateCityLayout(): BuildingSpec[] {
  if (cached) return cached;
  const buildings: BuildingSpec[] = [];
  for (let i = 0; i < BUILDINGS_PER_SIDE; i++) {
    for (const side of ["left", "right"] as const) {
      const seed = i * 2 + (side === "left" ? 0 : 1);
      const height = 18 + seededRandom(seed) * 42;
      const width = 8 + seededRandom(seed + 100) * 6;
      const depth = 8 + seededRandom(seed + 200) * 6;
      const z = -i * PATH_SPACING;
      const x = (side === "left" ? -1 : 1) * (STREET_HALF_WIDTH + width / 2);
      const signageColor =
        SIGNAGE_PALETTE[Math.floor(seededRandom(seed + 300) * SIGNAGE_PALETTE.length)];
      buildings.push({ side, index: i, x, z, width, depth, height, signageColor });
    }
  }
  cached = buildings;
  return buildings;
}

export const MAX_ANCHOR_INDEX = BUILDINGS_PER_SIDE * 2 - 1;

/** Same (side, index) resolution `getAnchorPoint`/`getBuildingCenter` share --
 * factored out once so both stay consistent by construction. */
function resolveBuilding(swingIndex: number): BuildingSpec {
  const clamped = Math.max(0, Math.min(swingIndex, MAX_ANCHOR_INDEX));
  const side: "left" | "right" = clamped % 2 === 0 ? "left" : "right";
  const i = Math.floor(clamped / 2);
  const buildings = generateCityLayout();
  return (
    buildings.find((b) => b.side === side && b.index === i) ??
    buildings[buildings.length - 1]
  );
}

/** World-space swing anchor for a given swing_index, alternating sides. */
export function getAnchorPoint(swingIndex: number): [number, number, number] {
  const building = resolveBuilding(swingIndex);
  const innerFaceX =
    building.side === "left"
      ? building.x + building.width / 2
      : building.x - building.width / 2;
  return [innerFaceX, building.height * 0.72, building.z];
}

/** Same as `getAnchorPoint`, but pushed `clearance` units out into the
 * street, away from the building face -- for standing/resting the physics
 * character capsule at, not for the joint's own attach point. The joint
 * anchor itself must sit exactly on the surface (that's the actual swing
 * pivot); a capsule collider *centered* there would overlap the building's
 * own collider and visually clip into it. Physics-only concern -- the
 * scripted SwingRig (idle/result presentation) doesn't need this since it
 * has no collider to clip with. */
export function getRestingPoint(
  swingIndex: number,
  clearance = 0.5
): [number, number, number] {
  const building = resolveBuilding(swingIndex);
  const [x, y, z] = getAnchorPoint(swingIndex);
  const dir = building.side === "left" ? 1 : -1;
  return [x + dir * clearance, y, z];
}

/** World-space center of the building at a given swing_index -- matches
 * City.tsx's mesh placement (`position={[b.x, 0, b.z]}` with the box mesh
 * itself offset to `[0, b.height / 2, 0]` inside that group). Used to derive
 * a joint's local anchor on a building's fixed rigid body, which is
 * positioned at this same center (see BuildingColliders.tsx). */
export function getBuildingCenter(swingIndex: number): [number, number, number] {
  const building = resolveBuilding(swingIndex);
  return [building.x, building.height / 2, building.z];
}
