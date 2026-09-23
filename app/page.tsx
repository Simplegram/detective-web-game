"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSearch, Fingerprint, KeyRound, LoaderCircle } from "lucide-react";
import { blackwoodManorCase as caseData } from "@/data/cases";
import { getSupabaseBrowser } from "@/lib/supabase/client";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

function generateRoomCode(): string {
  return Array.from({ length: CODE_LENGTH }, () =>
    CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  ).join("");
}

export default function LandingPage() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startNewInvestigation() {
    setBusy(true);
    setError(null);
    const supabase = getSupabaseBrowser();
    const initialEvidence = caseData.documents
      .filter((d) => d.initialStage === 1)
      .map((d) => d.id);

    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const code = generateRoomCode();
        const { data: room, error: roomError } = await supabase
          .from("rooms")
          .insert({ code, case_id: caseData.id })
          .select()
          .single();
        if (roomError) {
          if (roomError.code === "23505") continue; // code collision, retry
          throw roomError;
        }
        const { error: stateError } = await supabase.from("room_state").insert({
          room_id: room.id,
          unlocked_evidence: initialEvidence,
          shared_notes: "",
        });
        if (stateError) throw stateError;
        router.push(`/room/${room.code}`);
        return;
      }
      throw new Error("Could not allocate a room code after several attempts.");
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
    <main className="noir-bg flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <p className="font-type mb-10 text-xs tracking-[0.35em] text-amber-200/50 uppercase">
        Metropolitan Police · Bureau of Unsolved Deaths
      </p>

      <h1 className="font-display text-5xl font-bold tracking-wide text-stone-100 sm:text-6xl">
        Cold Case Archives
      </h1>
      <p className="font-type mt-4 text-sm text-stone-400">
        Two to six detectives. One file. Solve it together, live.
      </p>

      {/* The open case — manila folder */}
      <section className="relative mt-14 w-full max-w-2xl">
        <div className="absolute -top-3 left-8 h-8 w-40 rounded-t-md bg-[#d9c9a3] shadow-md" />
        <div className="manila-card rounded-lg p-8 pt-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-type text-[11px] tracking-[0.3em] text-stone-600 uppercase">
                Open case · {caseData.id}
              </p>
              <h2 className="font-display mt-2 text-3xl leading-tight text-stone-900">
                {caseData.title}
              </h2>
            </div>
            <span className="stamp font-type shrink-0 px-3 py-1 text-xs font-bold text-blood">
              OPEN
            </span>
          </div>

          <p className="font-display mt-5 max-w-prose text-[17px] leading-relaxed text-stone-800 italic">
            {caseData.synopsis}
          </p>

          <dl className="font-type mt-6 grid grid-cols-2 gap-x-6 gap-y-2 border-t-2 border-stone-900/20 pt-4 text-[13px] text-stone-700 sm:grid-cols-4">
            <div>
              <dt className="text-[10px] tracking-[0.2em] uppercase opacity-70">Victim</dt>
              <dd>{caseData.victim.name}</dd>
            </div>
            <div>
              <dt className="text-[10px] tracking-[0.2em] uppercase opacity-70">Age</dt>
              <dd>{caseData.victim.age}</dd>
            </div>
            <div>
              <dt className="text-[10px] tracking-[0.2em] uppercase opacity-70">Difficulty</dt>
              <dd>{caseData.difficulty}</dd>
            </div>
            <div>
              <dt className="text-[10px] tracking-[0.2em] uppercase opacity-70">Case files</dt>
              <dd>{caseData.documents.length} recovered</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Actions */}
      <section className="mt-10 grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={startNewInvestigation}
          disabled={busy}
          className="group flex items-center justify-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-6 py-4 transition hover:bg-amber-500/20 disabled:opacity-50"
        >
          {busy ? (
            <LoaderCircle className="size-5 animate-spin text-amber-300" />
          ) : (
            <Fingerprint className="size-5 text-amber-300 transition group-hover:scale-110" />
          )}
          <span className="font-type text-sm tracking-[0.2em] text-amber-100 uppercase">
            {busy ? "Opening the file…" : "Start new investigation"}
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