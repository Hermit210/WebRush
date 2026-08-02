import { useEffect, useRef, useState } from "react";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { SolSocket, type Room } from "solsocket";
import { PublicKey } from "@solana/web3.js";

/**
 * Fixed, well-known "creator" wallet for the shared "webrush-lobby" room.
 * solsocket derives a room's on-chain address from (creator pubkey, room
 * name) -- `joinOrCreate`'s `creator` option defaults to the CALLING
 * wallet, so if every player left this unset, each distinct player would
 * silently spin up their own separate "webrush-lobby" room instead of
 * landing in one shared room together. This wallet already exists in the
 * project (it's the devnet deploy/treasury wallet) and pre-created the
 * room once via scripts/bootstrap-solsocket.ts -- every client here just
 * joins the room that already exists under it.
 */
const LOBBY_CREATOR = new PublicKey("B55s6G5z1HL4saF38ojeNDRWujoLbadZYCr1Wf3SWjEs");
const LOBBY_NAME = "webrush-lobby";
const STALE_MS = 8000;

export interface PresencePayload {
  multiplier: number;
  status: "swinging" | "idle" | "missed" | "cashed_out";
}

export interface OtherPlayer {
  key: string;
  short: string;
  multiplier: number;
  status: string;
  lastSeen: number;
}

/**
 * Shared-presence multiplayer (spec Stage B, "Option A" -- the lower-risk
 * mode: players see each other live in the same room, but money/escrow
 * stays entirely on the existing, untouched Anchor program). Connects on
 * mount whenever a wallet is available, joins the fixed shared room, and
 * exposes other present players + miss/cashout notifications.
 */
export function useSolsocketRoom() {
  const wallet = useAnchorWallet();
  const roomRef = useRef<Room<unknown, PresencePayload, unknown> | null>(null);
  const [ready, setReady] = useState(false);
  const [players, setPlayers] = useState<Record<string, OtherPlayer>>({});
  const [notifications, setNotifications] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const selfKey = wallet.publicKey.toBase58();

    (async () => {
      try {
        const sock = SolSocket.connect({ wallet, cluster: "devnet", region: "us" });
        const room = await sock.joinOrCreate<unknown, PresencePayload, unknown>(
          LOBBY_NAME,
          { creator: LOBBY_CREATOR }
        );
        if (cancelled) {
          await room.leave();
          return;
        }
        roomRef.current = room;
        setReady(true);

        unsubs.push(
          room.onPresence(({ player, data }) => {
            const key = player.toBase58();
            if (key === selfKey) return;
            setPlayers((prev) => ({
              ...prev,
              [key]: {
                key,
                short: `${key.slice(0, 4)}..${key.slice(-4)}`,
                multiplier: data.multiplier,
                status: data.status,
                lastSeen: Date.now(),
              },
            }));
          })
        );

        function pushNotification(text: string) {
          setNotifications((prev) => [...prev.slice(-2), text]);
          setTimeout(() => {
            setNotifications((prev) => prev.filter((n) => n !== text));
          }, 4000);
        }

        unsubs.push(
          room.onMessage("miss", ({ player, data }) => {
            const key = player.toBase58();
            if (key === selfKey) return;
            const short = `${key.slice(0, 4)}..${key.slice(-4)}`;
            const at = (data as { atMultiplier?: number })?.atMultiplier ?? 0;
            pushNotification(`${short} missed at ${at.toFixed(2)}x`);
          })
        );
        unsubs.push(
          room.onMessage("cashout", ({ player, data }) => {
            const key = player.toBase58();
            if (key === selfKey) return;
            const short = `${key.slice(0, 4)}..${key.slice(-4)}`;
            const at = (data as { atMultiplier?: number })?.atMultiplier ?? 0;
            pushNotification(`${short} cashed out at ${at.toFixed(2)}x`);
          })
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
      roomRef.current?.leave().catch(() => {});
      roomRef.current = null;
      setReady(false);
    };
  }, [wallet]);

  // Drop players we haven't heard from recently (they likely left/crashed
  // without a clean `leave()`, e.g. closed the tab).
  useEffect(() => {
    const id = setInterval(() => {
      setPlayers((prev) => {
        const now = Date.now();
        const next: typeof prev = {};
        for (const [key, p] of Object.entries(prev)) {
          if (now - p.lastSeen < STALE_MS) next[key] = p;
        }
        return next;
      });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  function broadcast(payload: PresencePayload) {
    roomRef.current?.broadcast(payload).catch(() => {
      // Best-effort -- a dropped presence update isn't worth surfacing as
      // a user-facing error, the next swing's broadcast will self-correct.
    });
  }

  function emitEvent(name: "miss" | "cashout", data: { atMultiplier: number }) {
    roomRef.current?.emit(name, data).catch(() => {});
  }

  return {
    ready,
    players: Object.values(players),
    notifications,
    error,
    broadcast,
    emitEvent,
  };
}
