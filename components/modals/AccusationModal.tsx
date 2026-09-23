"use client";

import { useEffect, useState } from "react";
import { FileSignature, LoaderCircle, X } from "lucide-react";
import type { CaseData, CaseStage, Room } from "@/types";
import { playSfx } from "@/lib/sfx";

/**
 * Official Accusation — the filing form for the current stage.
 * Posts to /api/verify; the judge (Chief Inspector Sterling) returns an
 * in-character debrief. On a correct verdict the room stage advances via
 * the stage_solved broadcast / DB update.
 */
interface VerifyResponse {
  isCorrect: boolean;
  feedback: string;
  unlockedEvidence: string[];
  isGameComplete: boolean;
  error?: string;
}

export function AccusationModal({
  room,
  caseData,
  stage,
  unlockedDocIds,
  submittedBy,
  onClose,
}: {
  room: Room;
  caseData: CaseData;
  stage: CaseStage;
  unlockedDocIds: string[];
  submittedBy: string;
  onClose: () => void;
}) {
  const [culprit, setCulprit] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<VerifyResponse | null>(null);

  // Dull buzzer on a rejected filing; victories ring the stage bell.
  useEffect(() => {
    if (result && !result.isCorrect) playSfx("buzzer");
  }, [result]);

  const unlockedDocs = caseData.documents.filter((d) => unlockedDocIds.includes(d.id));

  const toggleDoc = (id: string) =>
    setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const canSubmit = !!culprit && text.trim().length >= 10 && !submitting;

  async function submit() {
    setSubmitting(true);
    playSfx("stamp");
    setResult(null);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: room.id,
          stageNumber: stage.stageNumber,
          culprit,
          chosenClueIds: chosen,
          explanationText: text,
          submittedBy,
        }),
      });
      const data = (await res.json().catch(() => null)) as VerifyResponse | null;
      setResult(
        data ?? {
          isCorrect: false,
          feedback: "The Inspector's office returned no verdict. The line was dead.",
          unlockedEvidence: [],
          isGameComplete: false,
          error: res.statusText,
        },
      );
    } catch (e) {
      setResult({
        isCorrect: false,
        feedback: e instanceof Error ? e.message : "Network failure",
        unlockedEvidence: [],
        isGameComplete: false,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="noir-bg fixed inset-0 z-40 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70"
        onClick={submitting ? undefined : onClose}
        aria-hidden
      />
      <div className="manila-card font-type relative w-full max-w-2xl overflow-y-auto rounded-lg p-7" style={{ maxHeight: "92vh" }}>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="absolute top-4 right-4 rounded p-1 text-[#241d10]/60 transition hover:bg-black/10 disabled:opacity-30"
          aria-label="Close accusation form"
        >
          <X className="size-5" />
        </button>

        <div className="flex items-center gap-3 border-b-2 border-[#241d10]/20 pb-4">
          <FileSignature className="size-7 text-blood" />
          <div>
            <h2 className="font-display text-2xl text-[#241d10]">Official Accusation</h2>
            <p className="text-[11px] tracking-[0.25em] text-[#241d10]/60 uppercase">
              Affidavit of deduction — stage {stage.stageNumber}: {stage.title}
            </p>
          </div>
          <span className="stamp ml-auto shrink-0 text-[10px] font-bold text-blood">
            CONFIDENTIAL
          </span>
        </div>

        {/* Suspect */}
        <label className="mt-6 block">
          <span className="text-[11px] tracking-[0.25em] text-[#241d10]/70 uppercase">
            Who is responsible?
          </span>
          <select
            value={culprit}
            onChange={(e) => setCulprit(e.target.value)}
            disabled={submitting || !!result}
            className="mt-2 w-full rounded-md border-2 border-[#241d10]/30 bg-[#f4ecd8] px-3 py-2.5 text-sm text-[#241d10] outline-none focus:border-blood disabled:opacity-50"
          >
            <option value="" disabled>
              — Select a suspect from the case file —
            </option>
            {caseData.suspects.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} — {s.role}
              </option>
            ))}
          </select>
        </label>

        {/* Evidence picker */}
        <div className="mt-6">
          <p className="text-[11px] tracking-[0.25em] text-[#241d10]/70 uppercase">
            Cite the documents that support your theory
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {unlockedDocs.map((d) => {
              const active = chosen.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={submitting || !!result}
                  onClick={() => toggleDoc(d.id)}
                  className={`rounded-full border-2 px-3 py-1.5 text-xs transition disabled:opacity-50 ${
                    active
                      ? "border-blood bg-blood/15 font-bold text-blood"
                      : "border-[#241d10]/25 bg-[#f4ecd8] text-[#241d10]/80 hover:border-[#241d10]/50"
                  }`}
                >
                  {d.fileNumber} · {d.title}
                </button>
              );
            })}
          </div>
        </div>

        {/* Deductive reasoning */}
        <label className="mt-6 block">
          <span className="text-[11px] tracking-[0.25em] text-[#241d10]/70 uppercase">
            Deductive reasoning — state the contradiction
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={submitting || !!result}
            rows={6}
            placeholder="Where exactly does the record break? Name the times, the places, the impossibility — and which suspect it pins."
            className="mt-2 w-full resize-y rounded-md border-2 border-[#241d10]/30 bg-[repeating-linear-gradient(0deg,transparent,transparent_27px,#241d1014_28px)] px-3 py-2.5 leading-[28px] text-sm text-[#241d10] outline-none placeholder:text-[#241d10]/40 focus:border-blood disabled:opacity-50"
          />
          <span className="float-right text-[10px] text-[#241d10]/50">
            {text.trim().length}/10 min. characters
          </span>
        </label>

        {/* Submit */}
        <div className="mt-6 flex items-center justify-end gap-4">
          {submitting ? (
            <span className="flex items-center gap-3 text-sm text-[#241d10]/80">
              <LoaderCircle className="size-4 animate-spin text-blood" />
              Chief Inspector Sterling is reviewing the case file…
            </span>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-md border-2 border-[#241d10]/40 bg-[#241d10] px-6 py-2.5 text-xs tracking-[0.2em] text-manila uppercase transition hover:bg-[#3a2f1c] disabled:cursor-not-allowed disabled:opacity-40"
            >
              File the accusation
            </button>
          )}
        </div>

        {/* Debrief card */}
        {result && (
          <div
            className={`mt-6 rounded-md border-2 p-4 ${
              result.isCorrect
                ? "border-emerald-800/50 bg-emerald-900/10"
                : "border-blood/60 bg-blood/10"
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`stamp text-[11px] font-bold ${
                  result.isCorrect ? "text-emerald-800" : "text-blood"
                }`}
              >
                {result.isCorrect ? "ACCEPTED" : "REJECTED"}
              </span>
              <p className="text-[11px] tracking-[0.25em] text-[#241d10]/60 uppercase">
                Verdict of Chief Inspector Sterling
              </p>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[#241d10]">{result.feedback}</p>
            {result.isCorrect && result.isGameComplete && (
              <p className="mt-3 text-sm font-bold text-[#241d10]">
                The case is closed. {caseData.title} is sealed in the archives.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}