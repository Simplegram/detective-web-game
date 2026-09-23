"use client";
import { useEffect } from "react";
import { PartyPopper } from "lucide-react";
import type { CaseDocument } from "@/types";
import { playSfx } from "@/lib/sfx";

export function StageBanner({
  stageTitle,
  unlocked,
  onClose,
}: {
  stageTitle: string;
  unlocked: CaseDocument[];
  onClose: () => void;
}) {
  // The bell rings once per victory, on mount.
  useEffect(() => {
    playSfx("bell");
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
      <div className="relative w-full max-w-lg">
        <div className="manila-card rounded-lg p-8 text-center">
          <PartyPopper className="mx-auto size-10 text-amber-600" />
          <p className="font-type mt-4 text-[11px] tracking-[0.35em] text-stone-600 uppercase">
            Case advanced
          </p>
          <h2 className="font-display mt-2 text-4xl text-stone-900">{stageTitle}</h2>
          <div className="mx-auto mt-6 max-w-sm border-y-2 border-stone-900/30 py-4">
            <p className="font-type text-xs tracking-[0.25em] text-stone-700 uppercase">
              New evidence unsealed
            </p>
            <ul className="font-display mt-3 space-y-1.5 text-lg text-stone-800">
              {unlocked.map((d) => (
                <li key={d.id}>{d.title}</li>
              ))}
            </ul>
          </div>
          <p className="font-type mt-4 text-sm text-stone-700">
            The file opens deeper. Every detective in the room just saw this.
          </p>
          <span className="stamp font-type absolute top-6 right-6 px-3 py-1 text-sm font-bold text-blood">
            CASE ADVANCED
          </span>
          <button
            type="button"
            onClick={onClose}
            className="font-type mt-6 rounded bg-stone-900 px-6 py-2.5 text-sm tracking-[0.2em] text-amber-100 uppercase transition hover:bg-stone-800"
          >
            Continue the investigation
          </button>
        </div>
      </div>
    </div>
  );
}