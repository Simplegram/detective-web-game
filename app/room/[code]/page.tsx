"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ClipboardList,
  CloudRain,
  FolderOpen,
  Gavel,
  NotebookPen,
  Pin,
  Skull,
  Volume2,
  VolumeX,
} from "lucide-react";
import { resolveCase } from "@/data/cases";
import type { CaseDocument } from "@/types";
import { useRoomSync } from "@/hooks/useRoomSync";
import { NameGate, readPlayerId, readStoredName } from "@/components/room/NameGate";
import { PresenceBar } from "@/components/room/PresenceBar";
import { EvidenceList } from "@/components/room/EvidenceList";
import { DocumentViewer } from "@/components/room/DocumentViewer";
import { NotebookDrawer } from "@/components/room/NotebookDrawer";
import { CaseLogDrawer } from "@/components/room/CaseLogDrawer";
import { StageBanner } from "@/components/room/StageBanner";
import { AccusationModal } from "@/components/modals/AccusationModal";
import { Corkboard } from "@/components/room/Corkboard";
import {
  isMuted,
  isRainOn,
  playSfx,
  setMuted,
  setRain,
} from "@/lib/sfx";

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;

  const [ready, setReady] = useState(false);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    setReady(true);
    setName(readStoredName());
  }, []);

  if (!ready) {
    return <RoomSkeleton />;
  }

  if (!name) {
    return <NameGate onSubmit={(n) => setName(n)} />;
  }

  return <RoomShell code={code} playerId={readPlayerId()} name={name} />;
}

function RoomSkeleton() {
  return (
    <main className="noir-bg flex min-h-screen items-center justify-center">
      <div className="text-center">
        <FolderOpen className="mx-auto size-8 animate-pulse text-amber-400/70" />
        <p className="font-type mt-4 text-xs tracking-[0.35em] text-stone-500 uppercase">
          Opening the file…
        </p>
      </div>
    </main>
  );
}

function RoomShell({
  code,
  playerId,
  name,
}: {
  code: string;
  playerId: string;
  name: string;
}) {
  const player = { id: playerId, name };
  const sync = useRoomSync({ roomCode: code, player });
  const [openDoc, setOpenDoc] = useState<CaseDocument | null>(null);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [corkboardOpen, setCorkboardOpen] = useState(true);
  const [accusationOpen, setAccusationOpen] = useState(false);
  const [caseLogOpen, setCaseLogOpen] = useState(false);
  const [muted, setMutedState] = useState(() => isMuted());
  const [rain, setRainState] = useState(() => isRainOn());

  const caseData = resolveCase(sync.room?.case_id);
  const stage = caseData.stages.find((s) => s.stageNumber === sync.room?.current_stage);
  const caseClosed =
    !!sync.room &&
    (sync.room.solved || sync.room.current_stage > caseData.stages.length);

  const unlockedIds =
    sync.roomState?.unlocked_evidence ??
    caseData.documents
      .filter((d) => d.initialStage <= (sync.room?.current_stage ?? 1))
      .map((d) => d.id);

  const openDocPings = openDoc
    ? sync.pings.filter((p) => p.docId === openDoc.id)
    : [];

  const handleOpenDoc = (doc: CaseDocument) => {
    playSfx("paper");
    sync.setActiveDocId(doc.id);
    setOpenDoc(doc);
  };
  const closeDoc = () => {
    sync.setActiveDocId(null);
    setOpenDoc(null);
  };

  const solvedDocs = (sync.stageSolved?.unlockedEvidence ?? [])
    .map((id) => caseData.documents.find((d) => d.id === id))
    .filter((d): d is CaseDocument => Boolean(d));

  if (sync.error) {
    return (
      <main className="noir-bg flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <Skull className="mx-auto size-10 text-blood-bright" />
          <h1 className="font-display mt-4 text-3xl text-stone-100">
            No such file in the archives
          </h1>
          <p className="font-type mt-3 text-sm text-stone-400">
            {sync.error}
          </p>
          <Link
            href="/"
            className="font-type mt-8 inline-block rounded bg-stone-900 px-6 py-3 text-xs tracking-[0.25em] text-amber-100 uppercase transition hover:bg-stone-800"
          >
            Back to the archives
          </Link>
        </div>
      </main>
    );
  }

  if (!sync.isLoaded) {
    return <RoomSkeleton />;
  }

  return (
    <main className="noir-bg flex min-h-screen flex-col">
      {/* Top bar */}
      <header className="border-b border-stone-800/80 bg-noir-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link href="/" className="font-type text-xs tracking-[0.25em] text-stone-500 uppercase transition hover:text-amber-300">
            ← Archives
          </Link>
          <div className="min-w-0">
            <h1 className="font-display truncate text-xl text-stone-100 sm:text-2xl">
              {caseData.title}
            </h1>
            <p className="font-type text-[11px] tracking-[0.2em] text-stone-500 uppercase">
              Room {code} ·{" "}
              {caseClosed ? (
                <span className="text-amber-300">Case closed</span>
              ) : (
                <span className="text-amber-400/90">
                  Stage {sync.room?.current_stage ?? 1} of {caseData.stages.length}
                </span>
              )}
            </p>
          </div>

          <div className="ml-auto flex flex-col items-end gap-2">
            <PresenceBar players={sync.players} selfId={player.id} caseData={caseData} />
            <div className="flex flex-wrap items-center gap-2">

          {!caseClosed && (
            <button
              type="button"
              onClick={() => setAccusationOpen(true)}
              className="flex items-center gap-2 rounded-md border-2 border-blood bg-blood/90 px-4 py-2 text-amber-50 shadow-[0_0_24px] shadow-blood/30 transition hover:bg-blood-bright"
            >
              <Gavel className="size-4" />
              <span className="font-type text-xs font-bold tracking-[0.2em] uppercase">
                Submit theory / File accusation
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setNotebookOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full border border-stone-700/70 bg-noir-850 px-3 py-1.5 text-stone-300 transition hover:border-amber-500/50 hover:text-amber-200"
          >
            <NotebookPen className="size-4 text-amber-400/80" />
            <span className="relative inline-flex font-type text-xs tracking-[0.15em] uppercase">
              <span className="invisible">Shared notebook</span>
              <span className="absolute inset-0">
                {notebookOpen ? "Close notebook" : "Shared notebook"}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setCorkboardOpen((v) => !v)}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 transition ${
              corkboardOpen
                ? "border-amber-500/50 bg-noir-850 text-amber-200"
                : "border-stone-700/70 bg-noir-850 text-stone-300 hover:border-amber-500/50 hover:text-amber-200"
            }`}
          >
            <Pin className="size-4 text-amber-400/80" />
            <span className="relative inline-flex font-type text-xs tracking-[0.15em] uppercase">
              <span className="invisible">Hide corkboard</span>
              <span className="absolute inset-0">
                {corkboardOpen ? "Hide corkboard" : "Corkboard"}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setCaseLogOpen((v) => !v)}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 transition ${
              caseLogOpen
                ? "border-amber-500/50 bg-noir-850 text-amber-200"
                : "border-stone-700/70 bg-noir-850 text-stone-300 hover:border-amber-500/50 hover:text-amber-200"
            }`}
          >
            <ClipboardList className="size-4 text-amber-400/80" />
            <span className="relative inline-flex font-type text-xs tracking-[0.15em] uppercase">
              <span className="invisible">Close case log</span>
              <span className="absolute inset-0">
                {caseLogOpen ? "Close case log" : "Case log"}
              </span>
            </span>
          </button>
        </div>
      </div>
        </div>
      </header>

      {/* Settings — pinned top-right of the viewport: sound + ambient rain */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            setMutedState(next);
          }}
          title={muted ? "Sound off — click to enable" : "Sound on — click to mute"}
          aria-label={muted ? "Sound is off, click to enable sound" : "Sound is on, click to mute"}
          aria-pressed={muted}
          className={`flex size-9 items-center justify-center rounded-full border bg-noir-850/90 backdrop-blur transition ${
            muted
              ? "border-amber-500/50 text-amber-200"
              : "border-stone-700/70 text-stone-300 hover:border-amber-500/50 hover:text-amber-200"
          }`}
        >
          {muted ? (
            <VolumeX className="size-4" />
          ) : (
            <Volume2 className="size-4" />
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !rain;
            setRain(next);
            setRainState(next);
          }}
          title={rain ? "Rain on — click to stop" : "Rain off — click to enable"}
          aria-label={rain ? "Rain is on, click to stop" : "Rain is off, click to enable"}
          aria-pressed={rain}
          className={`flex size-9 items-center justify-center rounded-full border bg-noir-850/90 backdrop-blur transition ${
            rain
              ? "border-amber-500/50 text-amber-200"
              : "border-stone-700/70 text-stone-300 hover:border-amber-500/50 hover:text-amber-200"
          }`}
        >
          <CloudRain className="size-4" />
        </button>
      </div>

      {/* Desk */}
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {/* Stage objective card */}
        <section className="relative overflow-hidden rounded-lg border border-amber-500/25 bg-noir-850 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="font-type text-[11px] tracking-[0.3em] text-amber-400/80 uppercase">
                {caseClosed ? "Final stage" : `Current objective — stage ${stage?.stageNumber ?? 1}`}
              </p>
              <h2 className="font-display mt-2 text-3xl text-stone-100">
                {caseClosed ? "Case Closed" : stage?.title}
              </h2>
              <p className="font-type mt-3 text-sm leading-relaxed text-stone-300">
                {caseClosed
                  ? "Every thread has been pulled and every contradiction exposed. The file is sealed."
                  : stage?.objective}
              </p>
              {!caseClosed && (
                <p className="font-display mt-3 text-sm text-stone-500 italic">
                  {stage?.description}
                </p>
              )}
            </div>
            {!caseClosed && (
              <span className="stamp font-type shrink-0 px-3 py-1 text-xs font-bold text-blood">
                ACTIVE
              </span>
            )}
          </div>
        </section>

        {/* Evidence grid */}
        <section className="mt-10">
          <h2 className="font-type mb-4 text-xs tracking-[0.3em] text-stone-500 uppercase">
            Case files
          </h2>
          <EvidenceList
            caseData={caseData}
            unlockedIds={unlockedIds}
            totalDocs={caseData.documents.length}
            onOpen={handleOpenDoc}
          />
        </section>

        {/* Collaborative corkboard */}
        {corkboardOpen && (
          <section className="mt-10">
            <Corkboard
              caseData={caseData}
              pins={sync.roomState?.corkboard_pins ?? []}
              players={sync.players}
              playerName={name}
              unlockedDocs={caseData.documents.filter((d) =>
                unlockedIds.includes(d.id)
              )}
              onPinsChange={sync.updateCorkboard}
            />
          </section>
        )}

        <p className="font-type mt-12 pb-6 text-center text-[10px] tracking-[0.3em] text-stone-700 uppercase">
          All case files sync live between detectives in room {code}
        </p>
      </div>

      {/* Layers */}
      {openDoc && (
        <DocumentViewer
          doc={openDoc}
          pings={openDocPings}
          onPing={sync.emitPing}
          onClose={closeDoc}
        />
      )}
      {notebookOpen && (
        <NotebookDrawer
          value={sync.roomState?.shared_notes ?? ""}
          onChange={sync.updateSharedNotes}
          onClose={() => setNotebookOpen(false)}
        />
      )}
      {sync.stageSolved && (
        <StageBanner
          stageTitle={
            caseData.stages.find(
              (s) => s.stageNumber === sync.stageSolved!.stageNumber
            )?.title ?? `Stage ${sync.stageSolved.stageNumber} solved`
          }
          unlocked={solvedDocs}
          onClose={sync.clearStageSolved}
        />
      )}
      {accusationOpen && sync.room && !caseClosed && stage && (
        <AccusationModal
          room={sync.room}
          caseData={caseData}
          stage={stage}
          unlockedDocIds={unlockedIds}
          submittedBy={name}
          onClose={() => setAccusationOpen(false)}
        />
      )}
      {caseLogOpen && sync.room && (
        <CaseLogDrawer
          room={sync.room}
          deductions={sync.deductions}
          onClose={() => setCaseLogOpen(false)}
        />
      )}
    </main>
  );
}