"use client";

import { useState } from "react";
import { BadgeCheck } from "lucide-react";

export const NAME_KEY = "***";
const ID_KEY = "detective_id";

export function readStoredName(): string | null {
  if (typeof window === "undefined") return null;
  const n = window.localStorage.getItem(NAME_KEY);
  return n && n.length > 0 ? n : null;
}

export function readPlayerId(): string {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(ID_KEY, id);
  return id;
}

export function NameGate({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [name, setName] = useState("");

  const confirm = () => {
    const n = name.trim();
    if (n.length < 2) return;
    window.localStorage.setItem(NAME_KEY, n);
    onSubmit(n);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
      <div className="w-full max-w-md">
        <div className="manila-card rounded-lg p-1">
          <div className="flex items-center gap-4 rounded-md bg-[#c8b98f] px-5 py-4">
            <div className="flex h-16 w-12 shrink-0 items-end justify-center rounded-sm border-2 border-stone-900/60 bg-[#efe3c4]">
              <BadgeCheck className="mb-2 size-7 text-stone-700" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-type text-[10px] tracking-[0.3em] text-stone-600 uppercase">
                Metropolitan Police · Detectives
              </p>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirm()}
                placeholder="Enter Detective Name"
                maxLength={24}
                className="font-type mt-1 w-full border-b-2 border-stone-900/50 bg-transparent pb-1 text-lg text-stone-900 uppercase outline-none placeholder:text-stone-500"
                aria-label="Detective name"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <p className="font-type text-xs text-stone-600">
              Anonymous badge — only your partner detectives see your name.
            </p>
            <button
              type="button"
              onClick={confirm}
              disabled={name.trim().length < 2}
              className="font-type shrink-0 rounded bg-stone-900 px-4 py-2 text-xs tracking-[0.2em] text-amber-100 uppercase transition hover:bg-stone-800 disabled:opacity-40"
            >
              Take the badge
            </button>
          </div>
        </div>
        <p className="font-type mt-3 text-center text-xs tracking-[0.25em] text-stone-500 uppercase">
          Clearance required to open the file
        </p>
      </div>
    </div>
  );
}