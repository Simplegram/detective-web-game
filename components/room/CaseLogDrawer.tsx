"use client";

import { ClipboardList, X } from "lucide-react";
import type { DeductionLog, Room } from "@/types";

/**
 * The shared case log — every filed accusation, live for everyone in the
 * room (deduction_logs via Supabase Realtime).
 */
export function CaseLogDrawer({
  room,
  deductions,
  onClose,
}: {
  room: Room;
  deductions: DeductionLog[];
  onClose: () => void;
}) {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-stone-700/60 bg-noir-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-stone-700/60 px-5 py-3">
        <h2 className="font-display flex items-center gap-2 text-xl text-stone-100">
          <ClipboardList className="size-5 text-amber-400/80" />
          Case Log
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1.5 text-stone-400 transition hover:bg-stone-800 hover:text-stone-100"
          aria-label="Close case log"
        >
          <X className="size-5" />
        </button>
      </div>
      <p className="font-type px-5 pt-3 text-[11px] tracking-[0.25em] text-stone-500 uppercase">
        Room {room.code} · every filing, as it happens
      </p>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {deductions.length === 0 && (
          <p className="font-type text-sm text-stone-500">
            Nothing filed yet. The Inspector waits for a theory worth his time.
          </p>
        )}
        {deductions.map((d) => (
          <article key={d.id} className="rounded-md border border-stone-700/50 bg-noir-850 p-4">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="stamp text-[9px] font-bold text-blood">
                {d.is_correct ? "ACCEPTED" : "REJECTED"}
              </span>
              <span className="font-type text-[11px] tracking-[0.2em] text-amber-300/90 uppercase">
                {d.submitted_by}
              </span>
              <span className="font-type text-[10px] text-stone-500">
                stage {d.stage} ·{" "}
                {new Date(d.created_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </header>
            <p className="font-type mt-2 line-clamp-3 text-xs leading-relaxed text-stone-300">
              {d.theory}
            </p>
            <p className="font-type mt-2 border-l-2 border-amber-500/30 pl-3 text-xs leading-relaxed text-stone-400 italic">
              Sterling: {d.feedback}
            </p>
          </article>
        ))}
      </div>
    </aside>
  );
}