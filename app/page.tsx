"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  FileSearch,
  Fingerprint,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Skull,
} from "lucide-react";
import { getAllCaseSummaries } from "@/data/cases";

const CODE_LENGTH = 6;

const DIFFICULTY_BADGE: Record<string, string> = {
  Easy: "border-emerald-500/60 bg-emerald-500/15 text-emerald-300",
  Medium: "border-orange-500/60 bg-orange-500/15 text-orange-300",
  Hard: "border-blood-bright bg-blood/25 text-blood-bright",
};

export default function LandingPage() {
  const router = useRouter();
  const summaries = useMemo(() => getAllCaseSummaries(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    summaries.find((s) => s.id === selectedId) ?? summaries[0] ?? null;
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startNewInvestigation() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      // Room provisioning (code allocation + stage-1 evidence seeding) runs
      // server-side so unlocked evidence always matches the chosen case file.
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: selected.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Room service failed (${res.status}).`);
      }
      const { code } = (await res.json()) as { code: string };
      router.push(`/room/${code}`);
      return;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  function joinInvestigation() {
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      setError("Room codes are 6 characters, A–Z and 0–9.");
      return;
    }
    setError(null);
    router.push(`/room/${code}`);
  }

  return (
    <main className="noir-bg flex min-h-screen flex-col items-center px-6 py-16">
      <p className="font-type mb-10 text-xs tracking-[0.35em] text-amber-200/50 uppercase">
        Metropolitan Police · Bureau of Unsolved Deaths
      </p>

      <h1 className="font-display text-5xl font-bold tracking-wide text-stone-100 sm:text-6xl">
        Cold Case Archives
      </h1>
      <p className="font-type mt-4 text-sm text-stone-400">
        Two to six detectives. One file. Solve it together, live.
      </p>

      {/* Case shelf — manila folders on the mahogany desk */}
      <section
        className="mt-14 w-full max-w-4xl rounded-lg border border-black/50 p-6 shadow-[0_30px_60px_-25px_rgba(0,0,0,0.9)]"
        style={{
          background:
            "linear-gradient(165deg, #5a3420 0%, #462718 45%, #33190f 100%)",
        }}
      >
        <p className="font-type mb-5 text-[10px] tracking-[0.35em] text-amber-200/60 uppercase">
          Case shelf · {summaries.length} open file{summaries.length === 1 ? "" : "s"} — select one
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          {summaries.map((c) => {
            const isSelected = selected?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={`group relative rounded-lg text-left transition ${
                  isSelected ? "" : "opacity-80 hover:opacity-100"
                }`}
              >
                {/* folder tab */}
                <span
                  className={`absolute -top-2.5 left-5 h-5 w-24 rounded-t-md ${
                    isSelected ? "bg-[#e6d5ac]" : "bg-[#d9c9a3]"
                  }`}
                />
                <span
                  className={`manila-card relative block rounded-lg p-5 pt-7 transition ${
                    isSelected
                      ? "shadow-[0_0_0_2px_rgba(251,191,36,0.7),0_18px_40px_-18px_rgba(0,0,0,0.9)]"
                      : "shadow-md"
                  }`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="font-type block text-[10px] tracking-[0.3em] text-stone-600 uppercase">
                        {c.id}
                      </span>
                      <span className="font-display mt-1 block text-xl leading-tight text-stone-900">
                        {c.title}
                      </span>
                    </span>
                    <span
                      className={`font-type shrink-0 rounded border px-2 py-0.5 text-[10px] font-bold tracking-[0.2em] uppercase ${DIFFICULTY_BADGE[c.difficulty] ?? ""}`}
                    >
                      {c.difficulty}
                    </span>
                  </span>

                  <span className="font-display mt-3 block max-w-prose text-[13px] leading-relaxed text-stone-700 italic">
                    {c.synopsis}
                  </span>

                  <span className="mt-4 flex items-center gap-4 border-t-2 border-stone-900/20 pt-3 text-stone-700">
                    <span className="font-type flex items-center gap-1.5 text-[11px] tracking-[0.15em] uppercase">
                      <Skull className="size-3.5 opacity-60" />
                      {c.victim}
                    </span>
                    <span className="font-type flex items-center gap-1.5 text-[11px] tracking-[0.15em] uppercase">
                      <Clock className="size-3.5 opacity-60" />
                      {c.estimatedTime}
                    </span>
                    <span className="font-type flex items-center gap-1.5 text-[11px] tracking-[0.15em] uppercase">
                      <FileSearch className="size-3.5 opacity-60" />
                      {c.documentCount} files
                    </span>
                  </span>

                  {c.victimDescription && (
                    <span className="font-type mt-2 block text-[11px] text-stone-600">
                      {c.victimDescription}
                    </span>
                  )}
                  {c.tags && c.tags.length > 0 && (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {c.tags.map((t) => (
                        <span
                          key={t}
                          className="font-type rounded border border-stone-900/25 px-1.5 py-0.5 text-[10px] tracking-[0.15em] text-stone-600 uppercase"
                        >
                          {t}
                        </span>
                      ))}
                    </span>
                  )}

                  {isSelected && (
                    <span className="stamp font-type absolute -top-2 -right-2 rotate-6 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                      <FolderOpen className="mr-1 inline size-3" />
                      SELECTED
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Actions */}
      <section className="mt-10 grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={startNewInvestigation}
          disabled={busy || !selected}
          className="group flex items-center justify-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-6 py-4 transition hover:bg-amber-500/20 disabled:opacity-50"
        >
          {busy ? (
            <LoaderCircle className="size-5 animate-spin text-amber-300" />
          ) : (
            <Fingerprint className="size-5 text-amber-300 transition group-hover:scale-110" />
          )}
          <span className="font-type text-sm tracking-[0.2em] text-amber-100 uppercase">
            {busy
              ? "Opening the file…"
              : selected
                ? `Start investigation · ${selected.id}`
                : "Select a case file"}
          </span>
        </button>

        <div className="flex items-center gap-2 rounded-md border border-stone-700 bg-noir-850 px-4 py-1.5">
          <KeyRound className="size-5 shrink-0 text-stone-500" />
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, CODE_LENGTH))}
            onKeyDown={(e) => e.key === "Enter" && joinInvestigation()}
            placeholder="ROOM CODE"
            maxLength={CODE_LENGTH}
            className="font-type w-full bg-transparent py-2 text-sm tracking-[0.3em] text-stone-100 uppercase outline-none placeholder:text-stone-600"
            aria-label="Room code"
          />
          <button
            type="button"
            onClick={joinInvestigation}
            disabled={busy}
            className="font-type shrink-0 rounded bg-stone-800 px-3 py-1.5 text-xs tracking-[0.2em] text-stone-300 uppercase transition hover:bg-stone-700 disabled:opacity-50"
          >
            Join
          </button>
        </div>
      </section>

      {error && (
        <p className="font-type mt-6 max-w-xl text-center text-sm text-red-400">
          {error}
        </p>
      )}

      <p className="font-type mt-16 flex items-center gap-2 text-[11px] tracking-[0.3em] text-stone-600 uppercase">
        <FileSearch className="size-3.5" />
        Case files are shared live between all detectives in a room
      </p>
    </main>
  );
}