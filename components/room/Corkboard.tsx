"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Camera,
  FileText,
  Lightbulb,
  Pin,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import type { CaseDocument, CorkboardPin, PlayerPresence, PinType } from "@/types";
import { blackwoodManorCase as caseData } from "@/data/cases";
import { playSfx } from "@/lib/sfx";

/**
 * Collaborative corkboard — the detective wall.
 *
 * Four pin kinds (suspect / photo / note / evidence). Pins are placed with
 * one click, rearranged by dragging (pointer events, mouse + touch), and
 * removed with a double-click or the hover/focus delete badge. The board
 * persists to `room_state.corkboard_pins`, so every pin move syncs to all
 * detectives in the room via Supabase Realtime. A pin's "by" tag glows
 * while that detective is present in the room.
 *
 * Flicker-free dragging: the component keeps an optimistic local mirror of
 * the pins. Incoming room_state updates only replace the mirror when no
 * drag is in flight, and a pin dropped within the last ECHO_MS keeps its
 * local coordinates so a stale realtime echo can't rubber-band it back to
 * its pre-drag position. Pins are positioned purely with
 * `transform: translate3d(...)` (tracked board size) so drag frames are
 * compositor-only — no per-frame layout.
 *
 * Reliable gestures: a pointer press only becomes a drag once the cursor
 * travels DRAG_DEADZONE_PX (micro-jitter in a double-click never lurches
 * the pin and the scale-lift only engages on a real drag). Release without
 * dragging is a clean tap; two clean taps inside DOUBLE_TAP_MS
 * (DOUBLE_TAP_DIST_PX apart) remove the pin — done in pointerup timestamps
 * because native dblclick is unreliable under pointer capture.
 */

const PIN_STYLE: Record<PinType, { dot: string; card: string; Icon: LucideIcon; label: string }> = {
  suspect: {
    dot: "bg-blood-bright",
    card: "border-stone-500 bg-stone-900 text-stone-100",
    Icon: User,
    label: "Suspect",
  },
  photo: {
    dot: "bg-cyan-400",
    card: "border-stone-300 bg-[#f2efe6] text-stone-800",
    Icon: Camera,
    label: "Photo",
  },
  note: {
    dot: "bg-lime-400",
    card: "border-amber-500/60 bg-amber-200 text-stone-900",
    Icon: Lightbulb,
    label: "Note",
  },
  evidence: {
    dot: "bg-amber-300",
    card: "border-[#241d10]/30 bg-[#e7d9b8] text-stone-900",
    Icon: FileText,
    label: "Evidence",
  },
};

/** Window in which a locally dropped pin is shielded from stale echoes. */
const ECHO_MS = 800;
/** Pointer travel before a press becomes a drag (immune to click jitter). */
const DRAG_DEADZONE_PX = 5;
/** Two clean taps within this window (and 10px) count as a double-click. */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_DIST_PX = 10;

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}
function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Undirected yarn connections as deduplicated edges. The stable key
 * orders the two pin IDs lexicographically, so A→B and B→A collapse.
 */
export function getUniqueConnections(
  pins: CorkboardPin[],
): Array<{ fromId: string; toId: string; key: string }> {
  const seen = new Set<string>();
  const edges: Array<{ fromId: string; toId: string; key: string }> = [];
  for (const pin of pins) {
    for (const otherId of pin.connectedTo ?? []) {
      if (otherId === pin.id) continue;
      const key = pin.id < otherId ? `${pin.id}-${otherId}` : `${otherId}-${pin.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(
        pin.id < otherId
          ? { fromId: pin.id, toId: otherId, key }
          : { fromId: otherId, toId: pin.id, key },
      );
    }
  }
  return edges;
}

/**
 * Catenary-ish yarn sag as a quadratic bezier: longer spans droop more
 * (clamped to a readable 10–45px).
 */
function yarnGeometry(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const sag = Math.min(45, Math.max(10, Math.hypot(x2 - x1, y2 - y1) * 0.08));
  return {
    d: `M ${x1} ${y1} Q ${mx} ${my + sag} ${x2} ${y2}`,
    midX: mx,
    midY: my + sag,
  };
}

function makePin(type: PinType, unlockedDocs: CaseDocument[]): CorkboardPin {
  let label = "Note";
  if (type === "suspect") {
    label = caseData.suspects[Math.floor(Math.random() * caseData.suspects.length)].name;
  } else if (type === "evidence") {
    const pool = unlockedDocs.length ? unlockedDocs : caseData.documents;
    const d = pool[Math.floor(Math.random() * pool.length)];
    label = `${d.fileNumber} ${d.title}`;
  } else if (type === "photo") {
    label = "Scene photo";
  }
  return {
    id: crypto.randomUUID(),
    type,
    x: rand(12, 88),
    y: rand(16, 84),
    label,
    connectedTo: [],
  };
}

function samePins(a: CorkboardPin[], b: CorkboardPin[]): boolean {
  if (a.length !== b.length) return false;
  return b.every((p, i) => {
    const q = a[i];
    const aConn = q.connectedTo ?? [];
    const bConn = p.connectedTo ?? [];
    return (
      q.id === p.id &&
      q.x === p.x &&
      q.y === p.y &&
      q.type === p.type &&
      q.label === p.label &&
      (q.by ?? "") === (p.by ?? "") &&
      aConn.length === bConn.length &&
      aConn.every((id, j) => id === bConn[j])
    );
  });
}

export function Corkboard({
  pins,
  players,
  playerName,
  unlockedDocs,
  onPinsChange,
}: {
  pins: CorkboardPin[];
  players: PlayerPresence[];
  playerName: string;
  unlockedDocs: CaseDocument[];
  onPinsChange: (pins: CorkboardPin[]) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  /** Pixel size of the cork surface (for transform-based pin placement). */
  const [boardSize, setBoardSize] = useState({ w: 0, h: 0 });
  /** Optimistic local mirror of room_state.corkboard_pins. */
  const [localPins, setLocalPins] = useState<CorkboardPin[]>(pins);
  /** Live percent coordinates of the pin currently under the pointer. */
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  /** Press that hasn't crossed the drag deadzone yet. */
  const pendingRef = useRef<{ id: string; startX: number; startY: number } | null>(null);
  /** True once the current press has crossed the deadzone (a real drag). */
  const hasDraggedRef = useRef(false);
  /** Last clean tap (for double-click detection on pointerup). */
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });
  /** Pins touched locally (drop/add) → shielded from stale echoes. */
  const touchRef = useRef(new Map<string, number>());
  /** Yarn mode: pin presses connect/cut strings instead of dragging. */
  const [stringMode, setStringMode] = useState(false);
  /** Pin id selected as the yarn's starting point (yarn mode). */
  const [connectingSource, setConnectingSource] = useState<string | null>(null);
  /** Live draft yarn endpoint in board pixels while a source is selected. */
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  /** Edge key under the pointer (brighter render + cut affordance). */
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);

  const online = new Set(players.map((p) => p.name));

  // Track the board's pixel size so pins can be positioned purely with
  // transforms (compositor-only frames, no per-drag-frame layout).
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBoardSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ESC cancels the in-progress yarn (stays in string mode).
  useEffect(() => {
    if (!stringMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConnectingSource(null);
        setDraft(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stringMode]);

  // Mirror incoming room_state into the local mirror — but never while a
  // drag is in flight, and never clobbering a pin dropped (or added) within
  // the ECHO_MS window, whose DB write has not round-tripped yet.
  useEffect(() => {
    if (draggingRef.current) return;
    const now = Date.now();
    const protectedIds = new Set<string>();
    for (const [id, at] of touchRef.current) {
      if (now - at < ECHO_MS) protectedIds.add(id);
      else touchRef.current.delete(id);
    }
    const parent = pins;
    setLocalPins((prev) => {
      const localById = new Map(prev.map((p) => [p.id, p]));
      const next: CorkboardPin[] = parent.map((p) => {
        if (!protectedIds.has(p.id)) return p;
        const local = localById.get(p.id);
        return local ? { ...p, x: local.x, y: local.y, by: local.by } : p;
      });
      for (const p of prev) {
        // Locally added/dropped pin the parent row doesn't know about yet.
        if (protectedIds.has(p.id) && !parent.some((q) => q.id === p.id)) next.push(p);
      }
      return samePins(prev, next) ? prev : next;
    });
  }, [pins]);

  const toPercent = (e: React.PointerEvent) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return { x: 50, y: 50 };
    return {
      x: clamp(((e.clientX - rect.left) / rect.width) * 100, 4, 96),
      y: clamp(((e.clientY - rect.top) / rect.height) * 100, 6, 94),
    };
  };

  const addPin = (type: PinType) => {
    const pin = makePin(type, unlockedDocs);
    pin.by = playerName;
    const next = [...localPins, pin];
    setLocalPins(next);
    touchRef.current.set(pin.id, Date.now());
    onPinsChange(next);
  };

  const removePin = (id: string) => {
    // Cascade: strip the removed pin from every other pin's yarn so no
    // orphaned string is ever rendered.
    if (connectingSource === id) {
      setConnectingSource(null);
      setDraft(null);
    }
    const next = localPins
      .filter((p) => p.id !== id)
      .map((p) =>
        (p.connectedTo ?? []).includes(id)
          ? { ...p, connectedTo: p.connectedTo.filter((cid) => cid !== id) }
          : p,
      );
    setLocalPins(next);
    onPinsChange(next);
  };

  // --- Yarn mode: click-to-connect state machine (no drag). ---
  const pressStringPin = (pin: CorkboardPin) => {
    if (!connectingSource) {
      setConnectingSource(pin.id);
      return;
    }
    if (connectingSource === pin.id) {
      setConnectingSource(null);
      setDraft(null);
      return;
    }
    const aId = connectingSource;
    const bId = pin.id;
    const a = localPins.find((p) => p.id === aId);
    if (!a) {
      setConnectingSource(null);
      setDraft(null);
      return;
    }
    const already = a.connectedTo.includes(bId) || pin.connectedTo.includes(aId);
    const next = localPins.map((p) => {
      if (p.id !== aId && p.id !== bId) return p;
      const other = p.id === aId ? bId : aId;
      const has = p.connectedTo.includes(other);
      if (has === !already) return p; // already in the desired state
      return {
        ...p,
        connectedTo: has
          ? p.connectedTo.filter((id) => id !== other)
          : [...p.connectedTo, other],
      };
    });
    playSfx("pluck");
    setLocalPins(next);
    onPinsChange(next);
    setConnectingSource(null);
    setDraft(null);
  };

  /** Cut a yarn link (click on a thread), keeping both pin rows in sync. */
  const cutConnection = (aId: string, bId: string) => {
    const next = localPins.map((p) => {
      if (p.id !== aId && p.id !== bId) return p;
      const other = p.id === aId ? bId : aId;
      if (!p.connectedTo.includes(other)) return p;
      return { ...p, connectedTo: p.connectedTo.filter((id) => id !== other) };
    });
    playSfx("pluck");
    setLocalPins(next);
    onPinsChange(next);
    if (connectingSource === aId || connectingSource === bId) {
      setConnectingSource(null);
      setDraft(null);
    }
  };

  // --- Pointer press: record start point; NOT a drag yet (deadzone). ---
  const startPointer = (e: React.PointerEvent, pin: CorkboardPin) => {
    if (e.button !== 0) return; // primary button only
    if (stringMode) {
      // Yarn mode: a press is a selection, never a drag.
      e.stopPropagation();
      pressStringPin(pin);
      return;
    }
    draggingRef.current = true;
    hasDraggedRef.current = false;
    pendingRef.current = { id: pin.id, startX: e.clientX, startY: e.clientY };
    // Capture immediately so sub-deadzone moves still reach this element.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const movePointer = (e: React.PointerEvent) => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (!drag) {
      // Inside the deadzone: a jittery press, not a drag.
      const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
      if (dist <= DRAG_DEADZONE_PX) return;
      hasDraggedRef.current = true;
      const pos = toPercent(e);
      setDrag({ id: pending.id, x: pos.x, y: pos.y });
      return;
    }
    const pos = toPercent(e);
    setDrag({ id: drag.id, x: pos.x, y: pos.y });
  };

  // --- Pointer release: clean tap → double-click check; drag → commit. ---
  const endPointer = (e: React.PointerEvent, pin: CorkboardPin) => {
    if (!pendingRef.current) return;
    pendingRef.current = null;
    draggingRef.current = false;

    if (hasDraggedRef.current) {
      hasDraggedRef.current = false;
      if (drag) {
        // 1. Commit to the local mirror FIRST, so clearing the drag can
        //    never re-render the pin from the still-stale room_state prop.
        const updatedPins = localPins.map((p) =>
          p.id === drag.id ? { ...p, x: drag.x, y: drag.y, by: playerName } : p
        );
        setLocalPins(updatedPins);
        playSfx("thud");
        touchRef.current.set(drag.id, Date.now());
        // 2. Only then persist (pointer capture auto-releases on pointerup).
        onPinsChange(updatedPins);
        setDrag(null);
      }
      return;
    }

    // Clean click (never crossed the deadzone).
    const now = Date.now();
    const last = lastTapRef.current;
    if (
      now - last.time < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_DIST_PX
    ) {
      // Guaranteed double-click → remove the pin.
      lastTapRef.current = { time: 0, x: 0, y: 0 };
      removePin(pin.id);
      return;
    }
    lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
  };

  return (
    <section
      className="rounded-lg p-3 shadow-[0_25px_60px_-20px_rgba(0,0,0,0.8)]"
      style={{
        background:
          "linear-gradient(160deg, #3d2b1a 0%, #2c1f12 45%, #1f150c 100%)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-black/40 px-1 pb-3">
        <span className="font-display flex items-center gap-2 text-lg text-amber-100/90">
          <Pin className="size-5 text-amber-400/80" />
          Corkboard
        </span>
        <span className="font-type text-[10px] tracking-[0.25em] text-amber-100/40 uppercase">
          drag to arrange · double-click or × to remove · syncs to the room
        </span>
        <button
          type="button"
          onClick={() => {
            setConnectingSource(null);
            setDraft(null);
            setStringMode((v) => !v);
          }}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 transition ${
            stringMode
              ? "border-blood-bright bg-blood/25 text-amber-50 shadow-[0_0_18px] shadow-blood/40"
              : "border-black/50 bg-black/30 text-amber-100/80 hover:border-amber-400/50 hover:bg-black/50 hover:text-amber-100"
          }`}
        >
          <span aria-hidden>🧶</span>
          <span className="font-type text-[11px] tracking-[0.15em] uppercase">
            {stringMode ? "String Mode" : "Connect Yarn"}
          </span>
        </button>
        {stringMode && (
          <span className="font-type rounded-md border border-blood/60 bg-noir-900/80 px-3 py-1.5 text-[10px] tracking-[0.2em] text-blood-bright uppercase">
            {connectingSource
              ? "Now pick a target pin"
              : "Click a pin, then a target pin"}
            {" · "}ESC cancels
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {(Object.keys(PIN_STYLE) as PinType[]).map((t) => {
            const s = PIN_STYLE[t];
            return (
              <button
                key={t}
                type="button"
                onClick={() => addPin(t)}
                className="flex items-center gap-1.5 rounded-md border border-black/50 bg-black/30 px-3 py-1.5 text-amber-100/80 transition hover:border-amber-400/50 hover:bg-black/50 hover:text-amber-100"
              >
                <s.Icon className="size-3.5" />
                <span className="font-type text-[11px] tracking-[0.15em] uppercase">
                  Pin {s.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cork surface */}
      <div
        ref={boardRef}
        className="relative mt-3 h-[420px] select-none overflow-hidden rounded-md"
        onPointerDown={(e) => {
          // Empty-board press cancels an in-progress yarn (pins handle it themselves).
          if (!stringMode || !connectingSource) return;
          if (e.target !== e.currentTarget) return;
          setConnectingSource(null);
          setDraft(null);
        }}
        onPointerMove={(e) => {
          // Draft yarn follows the cursor while a source pin is selected.
          if (!stringMode || !connectingSource) return;
          const rect = boardRef.current?.getBoundingClientRect();
          if (!rect) return;
          setDraft({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }}
        style={{
          background:
            "radial-gradient(rgba(0,0,0,0.28) 1px, transparent 1.4px), linear-gradient(135deg, #8a5a33 0%, #7a4e2b 40%, #66401f 100%)",
          backgroundSize: "9px 9px, cover",
          boxShadow: "inset 0 0 45px rgba(0,0,0,0.55)",
          touchAction: "none",
          cursor: stringMode ? "crosshair" : undefined,
        }}
      >
        {localPins.length === 0 && (
          <p className="font-type absolute inset-0 flex items-center justify-center p-8 text-center text-xs tracking-[0.2em] text-black/40 uppercase">
            The board is bare. Pin a suspect, a photo, a note, a document —
            start connecting threads.
          </p>
        )}

        {boardSize.w > 0 && boardSize.h > 0 && (
          <svg
            className="pointer-events-none absolute inset-0"
            width={boardSize.w}
            height={boardSize.h}
          >
            <defs>
              <filter id="yarn-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="3" stdDeviation="2" floodOpacity="0.6" />
              </filter>
            </defs>
            {(() => {
              const byId = new Map(localPins.map((p) => [p.id, p]));
              const source = connectingSource ? byId.get(connectingSource) : undefined;
              return (
                <>
                  {getUniqueConnections(localPins).map((edge) => {
                    const from = byId.get(edge.fromId);
                    const to = byId.get(edge.toId);
                    if (!from || !to) return null;
                    const fp = drag && drag.id === from.id ? drag : { x: from.x, y: from.y };
                    const tp = drag && drag.id === to.id ? drag : { x: to.x, y: to.y };
                    const g = yarnGeometry(
                      (fp.x / 100) * boardSize.w,
                      (fp.y / 100) * boardSize.h,
                      (tp.x / 100) * boardSize.w,
                      (tp.y / 100) * boardSize.h,
                    );
                    const hovered = hoverEdge === edge.key;
                    return (
                      <g key={edge.key}>
                        <path
                          d={g.d}
                          fill="none"
                          stroke={hovered ? "#f87171" : "#b91c1c"}
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          filter="url(#yarn-shadow)"
                        />
                        {/* Wide invisible hit-box: hover highlights, click cuts. */}
                        <path
                          d={g.d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={14}
                          style={{ pointerEvents: "stroke", cursor: "pointer" }}
                          onPointerEnter={() => setHoverEdge(edge.key)}
                          onPointerLeave={() => setHoverEdge(null)}
                          onClick={() => cutConnection(edge.fromId, edge.toId)}
                        />
                        {hovered && (
                          <text
                            x={g.midX}
                            y={g.midY - 10}
                            textAnchor="middle"
                            fontSize={11}
                            fill="#fecaca"
                            className="font-type"
                          >
                            ✂ cut string
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {source && draft && (
                    <path
                      d={yarnGeometry(
                        (source.x / 100) * boardSize.w,
                        (source.y / 100) * boardSize.h,
                        draft.x,
                        draft.y,
                      ).d}
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth={2}
                      strokeDasharray="7 5"
                      opacity={0.85}
                      filter="url(#yarn-shadow)"
                    />
                  )}
                </>
              );
            })()}
          </svg>
        )}

        {localPins.map((pin) => {
          const s = PIN_STYLE[pin.type];
          const isDragging = drag !== null && drag.id === pin.id;
          const pos =
            drag !== null && drag.id === pin.id
              ? { x: drag.x, y: drag.y }
              : { x: pin.x, y: pin.y };
          const px = (pos.x / 100) * boardSize.w;
          const py = (pos.y / 100) * boardSize.h;
          const byOnline = pin.by ? online.has(pin.by) : false;
          return (
            <div
              key={pin.id}
              onPointerDown={(e) => startPointer(e, pin)}
              onPointerMove={movePointer}
              onPointerUp={(e) => endPointer(e, pin)}
              onPointerCancel={(e) => endPointer(e, pin)}
              className="absolute left-0 top-0"
              style={{
                transform: `translate3d(${px}px, ${py}px, 0) translate(-50%, -50%)`,
                willChange: isDragging ? "transform" : undefined,
                touchAction: "none",
                cursor: stringMode ? "crosshair" : isDragging ? "grabbing" : "grab",
                zIndex: isDragging ? 30 : 10,
              }}
            >
              <div
                className={`group relative w-36 -rotate-1 ${isDragging ? "scale-105" : ""} ${
                  isDragging ? "" : "transition-transform"
                } ${
                  stringMode && connectingSource === pin.id
                    ? "animate-pulse ring-2 ring-red-500"
                    : ""
                }`}
              >
                {/* Delete badge — hover/focus-within only; never starts a drag */}
                <button
                  type="button"
                  aria-label={`Remove ${pin.label} from the corkboard`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerMove={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onClick={() => removePin(pin.id)}
                  className="absolute -top-2 -right-2 z-20 flex size-5 items-center justify-center rounded-full border border-blood-bright/70 bg-noir-900 text-blood-bright opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-noir-800 hover:text-amber-100"
                >
                  <X className="size-3" />
                </button>
                {/* Push pin */}
                <span
                  className={`absolute -top-1.5 left-1/2 z-10 size-3 -translate-x-1/2 rounded-full shadow ${s.dot} ${
                    byOnline ? "shadow-[0_0_10px] shadow-amber-300/80" : ""
                  }`}
                />
                <div
                  className={`border px-2.5 pb-2 pt-3 shadow-lg ${s.card}`}
                >
                  <p className="font-display line-clamp-2 text-[13px] leading-tight">
                    {pin.label}
                  </p>
                  <p className="font-type mt-1 flex items-center gap-1 text-[9px] tracking-[0.15em] uppercase opacity-60">
                    <s.Icon className="size-3" />
                    {s.label}
                  </p>
                  {pin.by && (
                    <p
                      className={`font-type mt-1.5 border-t border-current/20 pt-1 text-[9px] tracking-[0.1em] ${
                        byOnline ? "font-bold text-current" : "opacity-40"
                      }`}
                      title={byOnline ? `${pin.by} is online` : `${pin.by} (away)`}
                    >
                      {byOnline ? "● " : "○ "}
                      {pin.by}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}