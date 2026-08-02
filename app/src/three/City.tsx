import { useMemo } from "react";
import { generateCityLayout } from "./cityLayout";

/**
 * Procedural low-poly skyline: plain boxes + an emissive "signage" strip
 * per building. This is deliberately the fastest-to-build option the spec
 * calls out -- geometric detail matters far less here than the bloom/
 * lighting pass (Scene.tsx) for selling the neon-city look.
 */
export function City() {
  const buildings = useMemo(() => generateCityLayout(), []);

  return (
    <group>
      {/* Ground plane -- dark, slightly reflective-looking via low roughness */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -70]} receiveShadow={false}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#05060c" roughness={0.9} metalness={0.1} />
      </mesh>

      {buildings.map((b) => {
        const signageY = b.height * (0.3 + 0.4 * ((b.index % 3) / 3));
        const signageWidth = b.width * 0.7;
        const faceOffset = b.side === "left" ? b.width / 2 + 0.05 : -(b.width / 2 + 0.05);
        return (
          <group key={`${b.side}-${b.index}`} position={[b.x, 0, b.z]}>
            <mesh position={[0, b.height / 2, 0]}>
              <boxGeometry args={[b.width, b.height, b.depth]} />
              <meshStandardMaterial color="#232b52" roughness={0.75} metalness={0.2} />
            </mesh>
            {/* Emissive neon signage strip on the street-facing side */}
            <mesh position={[faceOffset, signageY, 0]}>
              <boxGeometry args={[0.1, 1.4, signageWidth]} />
              <meshStandardMaterial
                color={b.signageColor}
                emissive={b.signageColor}
                emissiveIntensity={2.2}
                toneMapped={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
