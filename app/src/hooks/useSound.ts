import { useCallback, useRef } from "react";

const SOUND_FILES = {
  tick: "/audio/tick.ogg",
  cashout: "/audio/cashout.ogg",
  miss: "/audio/miss.ogg",
  click: "/audio/click.ogg",
} as const;

type SoundName = keyof typeof SOUND_FILES;

/**
 * Simple sound-effect player (Stage C item #5 -- swing/tick, cash-out,
 * miss, button click cues). Caches one Audio element per clip and clones
 * it for each playback so overlapping triggers (e.g. clicking Cash Out
 * right as a tick lands) don't cut each other off.
 *
 * Assets: Kenney "Interface Sounds", CC0 -- see app/public/audio/LICENSE.txt.
 */
export function useSound() {
  const cacheRef = useRef<Partial<Record<SoundName, HTMLAudioElement>>>({});

  return useCallback((name: SoundName) => {
    let base = cacheRef.current[name];
    if (!base) {
      base = new Audio(SOUND_FILES[name]);
      base.volume = 0.5;
      cacheRef.current[name] = base;
    }
    const instance = base.cloneNode(true) as HTMLAudioElement;
    instance.volume = base.volume;
    instance.play().catch(() => {
      // Autoplay can be blocked before the user's first interaction with
      // the page -- harmless to swallow, the next cue succeeds once the
      // browser has registered a gesture (which Play/Cash Out clicks are).
    });
  }, []);
}
