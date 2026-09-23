"use client";

import type { PlayerPresence } from "@/types";
import { blackwoodManorCase as caseData } from "@/data/cases";

const COLORS = [
  "bg-emerald-400",
  "bg-amber-400",
  "bg-cyan-400",
  "bg-rose-400",
  "bg-violet-400",
  "bg-lime-400",
] as const;

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

function docTitle(docId: string | null): string | null {
  if (!docId) return null;
  return caseData.documents.find((d) => d.id === docId)?.title ?? null;
}

export function PresenceBar({
  players,
  selfId,
}: {
  players: PlayerPresence[];
  selfId: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {players.map((p) => {
        const reading = docTitle(p.activeDocId);
        return (
          <span
            key={p.id}
            className="flex items-center gap-2 rounded-full border border-stone-700/70 bg-noir-850 px-3 py-1.5"
            title={p.id === selfId ? "You" : undefined}
          >
            <span
              className={`size-2 rounded-full ${colorFor(p.name)} ${
                p.id === selfId ? "shadow-[0_0_8px] shadow-amber-300/60" : ""
              }`}
            />
            <span className="font-type text-xs text-stone-300">
              {p.id === selfId ? `${p.name} (you)` : p.name}
            </span>
            {reading && (
              <span className="font-type text-[11px] text-amber-200/70">
                · reading: {reading}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}