import { useEffect, useRef } from "react";

/**
 * Discrete, state-driven swing animation -- NOT a physics simulation (see
 * BUILD_PROMPT 2.2: "state machine with nice animation, not a physics
 * sandbox"). Each render just eases the hero sprite toward the building
 * index matching swingIndex; a real physics/rope sim was explicitly out of
 * scope for the hackathon timeline.
 */
export function Skyline({
  swingIndex,
  falling,
}: {
  swingIndex: number;
  falling: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    const buildingCount = 8;
    const targetX = Math.min(swingIndex, buildingCount - 1) / (buildingCount - 1);

    const draw = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      // Buildings
      for (let i = 0; i < buildingCount; i++) {
        const bw = width / buildingCount;
        const bh = 60 + ((i * 37) % 90);
        ctx.fillStyle = i <= swingIndex ? "#2c3a63" : "#1b2242";
        ctx.fillRect(i * bw + 6, height - bh, bw - 12, bh);
      }

      // Ease hero position toward target
      posRef.current += (targetX - posRef.current) * 0.15;
      const x = 20 + posRef.current * (width - 60);
      const bob = falling ? 0 : Math.sin(performance.now() / 180) * 6;
      const y = height - 90 + bob + (falling ? Math.min(60, (performance.now() % 600) / 6) : 0);

      // Web line
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.moveTo(x + 8, 0);
      ctx.lineTo(x + 8, y);
      ctx.stroke();

      // Hero (simple masked-silhouette placeholder, not licensed IP art)
      ctx.fillStyle = falling ? "#ff5d5d" : "#4dd0ff";
      ctx.beginPath();
      ctx.arc(x + 8, y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x + 3, y + 8, 10, 18);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [swingIndex, falling]);

  return <canvas ref={canvasRef} width={380} height={220} className="skyline" />;
}
