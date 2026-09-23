"use client";

/**
 * useRoomSync — realtime room engine for /room/[code].
 *
 * Single Supabase channel `room:${code}` carrying all three primitives:
 * - Broadcast "sync" events: heartbeat presence (this self-hosted
 *   instance's presence store does not sync cross-socket, so the player
 *   roster is derived from broadcast heartbeats),
 *   evidence pings, and stage_solved celebrations.
 * - Postgres changes on `rooms` (stage progression) and `room_state`
 *   (unlocked evidence, shared notes, corkboard) via the
 *   supabase_realtime publication.
 *
 * Presence rule: a player is "connected" while their last heartbeat
 * is younger than STALE_MS.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type {
  BroadcastEvent,
  CorkboardPin,
  DeductionLog,
  EvidencePing,
  PlayerPresence,
  Room,
  RoomState,
} from "@/types";

export const HEARTBEAT_MS = 4_000;
export const STALE_MS = 12_000;
export const NOTE_DEBOUNCE_MS = 500;
export const PING_TTL_MS = 2_600;
const SYNC_EVENT = "sync";

export interface UseRoomSyncParams {
  roomCode: string;
  player: { id: string; name: string };
}

export interface StageSolvedNotice {
  stageNumber: number;
  unlockedEvidence: string[];
}

export interface UseRoomSync {
  /** The rooms row for this room code (null until loaded / not found). */
  room: Room | null;
  /** The room_state row (notes, unlocked evidence, pins). */
  roomState: RoomState | null;
  /** Filing history from `deduction_logs` (newest first), live-updated. */
  deductions: DeductionLog[];
  /** Live player roster, sorted by name; self is always present. */
  players: PlayerPresence[];
  /** In-flight evidence pings (auto-expire after PING_TTL_MS). */
  pings: EvidencePing[];
  /** Set when a stage is solved; UI shows the celebration, calls clearStageSolved(). */
  stageSolved: StageSolvedNotice | null;
  /** True once the initial room + state fetch has completed. */
  isLoaded: boolean;
  error: string | null;
  activeDocId: string | null;
  /** Report which document this player is reading (rides on heartbeats). */
  setActiveDocId: (id: string | null) => void;
  /** Broadcast a coordinate ping to players reading the same document. */
  emitPing: (docId: string, x: number, y: number) => void;
  /** Debounced (500ms) write of shared notes to room_state. */
  updateSharedNotes: (text: string) => void;
  /** Write the corkboard pins (whole set) to room_state. */
  updateCorkboard: (pins: CorkboardPin[]) => void;
  clearStageSolved: () => void;
}

export function useRoomSync({
  roomCode,
  player,
}: UseRoomSyncParams): UseRoomSync {
  const [room, setRoom] = useState<Room | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [deductions, setDeductions] = useState<DeductionLog[]>([]);
  const [players, setPlayers] = useState<PlayerPresence[]>([]);
  const [pings, setPings] = useState<EvidencePing[]>([]);
  const [stageSolved, setStageSolved] = useState<StageSolvedNotice | null>(
    null
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDocId, setActiveDocIdState] = useState<string | null>(null);

  const roomCodeRef = useRef(roomCode);
  roomCodeRef.current = roomCode;
  const playerRef = useRef(player);
  playerRef.current = player;
  const activeDocRef = useRef(activeDocId);
  activeDocRef.current = activeDocId;
  const roomStateRef = useRef<RoomState | null>(null);
  roomStateRef.current = roomState;
  const stageSolvedRef = useRef<StageSolvedNotice | null>(null);
  stageSolvedRef.current = stageSolved;
  const roomRef = useRef<Room | null>(null);
  roomRef.current = room;
  /** Last note text this client wrote (or is debouncing) — suppresses self-echo. */
  const pendingNotesRef = useRef<string | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playersRef = useRef<Record<string, PlayerPresence>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);

  const setActiveDocId = useCallback((id: string | null) => {
    activeDocRef.current = id;
    setActiveDocIdState(id);
  }, []);

  const clearStageSolved = useCallback(() => setStageSolved(null), []);

  const refreshPlayers = useCallback(() => {
    const self = playerRef.current;
    const now = Date.now();
    const table = playersRef.current;
    for (const id of Object.keys(table)) {
      if (id !== self.id && now - table[id].lastSeen > STALE_MS) delete table[id];
    }
    if (!table[self.id]) {
      table[self.id] = {
        id: self.id,
        name: self.name,
        activeDocId: activeDocRef.current,
        lastSeen: Date.now(),
      };
    } else {
      table[self.id].name = self.name;
      table[self.id].activeDocId = activeDocRef.current;
    }
    setPlayers(Object.values(table).sort((a, b) => a.name.localeCompare(b.name)));
  }, []);

  const expirePings = useCallback(() => {
    const cutoff = Date.now() - PING_TTL_MS;
    setPings((prev) => {
      const next = prev.filter((p) => p.at > cutoff);
      return next.length === prev.length ? prev : next;
    });
  }, []);

  // ------------------------------------------------------------------
  // Effect 1: initial room + state fetch.
  // ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseBrowser();
    (async () => {
      const { data: roomRow } = await supabase
        .from("rooms")
        .select("*")
        .eq("code", roomCode)
        .maybeSingle();
      if (cancelled) return;
      if (!roomRow) {
        setError(`No room found with code "${roomCode}"`);
        setIsLoaded(true);
        return;
      }
      setRoom(roomRow);
      const { data: stateRow } = await supabase
        .from("room_state")
        .select("*")
        .eq("room_id", roomRow.id)
        .maybeSingle();
      if (cancelled) return;
      setRoomState(stateRow ?? null);
      const { data: logRows } = await supabase
        .from("deduction_logs")
        .select("*")
        .eq("room_id", roomRow.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      setDeductions((logRows ?? []) as DeductionLog[]);
      setIsLoaded(true);
    })().catch((e: unknown) => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : String(e));
        setIsLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  // ------------------------------------------------------------------
  // Effect 2: realtime channel once the room is known.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!room?.id) return;
    const roomId = room.id;
    const supabase = getSupabaseBrowser();
    const channel = supabase.channel(`room:${roomCode}`, {
      config: { broadcast: { self: true } },
    });
    channelRef.current = channel;

    const handleSync = (raw: unknown) => {
      const msg = raw as BroadcastEvent;
      if (!msg || typeof msg.event !== "string") return;
      if (msg.event === "heartbeat") {
        playersRef.current[msg.payload.id] = { ...msg.payload };
        refreshPlayers();
      } else if (msg.event === "ping") {
        setPings((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            docId: msg.payload.docId,
            x: msg.payload.x,
            y: msg.payload.y,
            senderName: msg.payload.senderName,
            at: Date.now(),
          },
        ]);
      } else if (msg.event === "stage_solved") {
        setStageSolved({
          stageNumber: msg.payload.stageNumber,
          unlockedEvidence: msg.payload.unlockedEvidence,
        });
        // Optimistic unlock; the room_state change will confirm.
        setRoomState((prev) => {
          if (!prev) return prev;
          const merged = [...prev.unlocked_evidence];
          for (const id of msg.payload.unlockedEvidence) {
            if (!merged.includes(id)) merged.push(id);
          }
          return {
            ...prev,
            unlocked_evidence: merged,
            updated_at: new Date().toISOString(),
          };
        });
      }
    };

    channel.on("broadcast", { event: SYNC_EVENT }, (msg) => handleSync(msg.payload));

    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
      (payload) => {
        const next = payload.new as Room;
        if (next && next.id === roomId) {
          setRoom((prev) => {
            if (prev && next.current_stage > prev.current_stage && !stageSolvedRef.current) {
              // Stage advanced in DB without a broadcast (e.g. we joined late
              // mid-broadcast gap) — surface the celebration from the DB row.
              setStageSolved({ stageNumber: next.current_stage, unlockedEvidence: [] });
            }
            return next;
          });
        }
      }
    );

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "room_state",
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        const next = payload.new as RoomState;
        if (!next || next.room_id !== roomId) return;
        // Suppress self-echo of our own debounced note write.
        if (
          pendingNotesRef.current !== null &&
          next.shared_notes === pendingNotesRef.current
        ) {
          pendingNotesRef.current = null;
          return;
        }
        setRoomState(next);
      }
    );

    channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "deduction_logs",
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        const row = payload.new as DeductionLog;
        if (!row || row.room_id !== roomId) return;
        setDeductions((prev) => [row, ...prev.filter((x) => x.id !== row.id)]);
      }
    );

    channel.subscribe();

    const heartbeat = setInterval(() => {
      const self = playerRef.current;
      channel.send({
        type: "broadcast",
        event: SYNC_EVENT,
        payload: {
          event: "heartbeat",
          payload: {
            id: self.id,
            name: self.name,
            activeDocId: activeDocRef.current,
            lastSeen: Date.now(),
          },
        },
      });
    }, HEARTBEAT_MS);

    const prune = setInterval(() => {
      refreshPlayers();
      expirePings();
    }, 1_000);

    return () => {
      clearInterval(heartbeat);
      clearInterval(prune);
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
      void supabase.removeChannel(channel);
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [room?.id, roomCode, refreshPlayers, expirePings]);

  // ------------------------------------------------------------------
  // Public actions
  // ------------------------------------------------------------------
  const emitPing = useCallback(
    (docId: string, x: number, y: number) => {
      const channel = channelRef.current;
      if (!channel) return;
      const self = playerRef.current;
      channel.send({
        type: "broadcast",
        event: SYNC_EVENT,
        payload: {
          event: "ping",
          payload: { docId, x, y, senderName: self.name },
        },
      });
    },
    []
  );

  const updateSharedNotes = useCallback(
    (text: string) => {
      pendingNotesRef.current = text;
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
      noteTimerRef.current = setTimeout(async () => {
        const roomId = roomStateRef.current?.room_id;
        if (!roomId) return;
        const supabase = getSupabaseBrowser();
        const { error } = await supabase
          .from("room_state")
          .update({ shared_notes: text, last_updated_by: playerRef.current.name })
          .eq("room_id", roomId);
        if (error) console.error("shared notes write failed:", error.message);
      }, NOTE_DEBOUNCE_MS);
    },
    []
  );

  const updateCorkboard = useCallback((pins: CorkboardPin[]) => {
    const roomId = roomStateRef.current?.room_id;
    if (!roomId) return;
    const supabase = getSupabaseBrowser();
    void supabase
      .from("room_state")
      .update({ corkboard_pins: pins, last_updated_by: playerRef.current.name })
      .eq("room_id", roomId)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error("corkboard write failed:", error.message);
      });
  }, []);

  return {
    room,
    roomState,
    deductions,
    players,
    pings,
    stageSolved,
    isLoaded,
    error,
    activeDocId,
    setActiveDocId,
    emitPing,
    updateSharedNotes,
    updateCorkboard,
    clearStageSolved,
  };
}