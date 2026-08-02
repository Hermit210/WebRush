import { useEffect } from "react";

const SPLASH_DURATION_MS = 1600;

/**
 * Brief branded splash before the menu -- pure presentation, auto-advances
 * (or click/tap to skip). No wallet interaction happens here at all; this
 * is what a player sees before the app asks them for anything, matching
 * how a normal mobile game shows its logo before ever touching identity/
 * auth (see README "Stage D" for the UX research this is based on).
 */
export function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, SPLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="splash-screen" onClick={onDone} role="button" tabIndex={0}>
      <div className="splash-logo">WebRush</div>
      <div className="splash-tagline">Swing. Climb. Cash out.</div>
      <div className="splash-hint">tap to continue</div>
    </div>
  );
}
