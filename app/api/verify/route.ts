/**
 * POST /api/verify
 * Body: { roomId, stageNumber, culprit, chosenClueIds, explanationText, submittedBy }
 *
 * Validates the submission against the room's current stage (never out of
 * order), grades it via the judge (LLM or deterministic fallback), logs the
 * attempt to `deduction_logs`, and — on a correct verdict — advances the
 * stage, unlocks the new evidence, and broadcasts `stage_solved` to the room.
 */
import { NextRequest, NextResponse } from "next/server";
import { CASES } from "@/data/cases";
import { judgeDeduction } from "@/lib/ai-judge";
import { sendRoomBroadcast } from "@/lib/supabase/broadcast";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface VerifyBody {
  roomId?: unknown;
  stageNumber?: unknown;
  culprit?: unknown;
  chosenClueIds?: unknown;
  explanationText?: unknown;
  submittedBy?: unknown;
}

export async function POST(req: NextRequest) {
  let body: VerifyBody;
  try {
    body = (await req.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const roomId = typeof body.roomId === "string" ? body.roomId : "";
  const stageNumber =
    typeof body.stageNumber === "number" && Number.isInteger(body.stageNumber) ? body.stageNumber : NaN;
  const culprit = typeof body.culprit === "string" ? body.culprit.trim() : "";
  const explanationText = typeof body.explanationText === "string" ? body.explanationText.trim() : "";
  const submittedBy =
    typeof body.submittedBy === "string" && body.submittedBy.trim()
      ? body.submittedBy.trim()
      : "Anonymous Detective";
  const chosenClueIds = Array.isArray(body.chosenClueIds)
    ? body.chosenClueIds.filter((x): x is string => typeof x === "string")
    : [];

  if (!roomId || !Number.isFinite(stageNumber) || !culprit || explanationText.length < 10) {
    return NextResponse.json(
      { error: "Expected roomId, stageNumber, culprit, explanationText (≥10 chars) and chosenClueIds." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServer();

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: "Room not found." }, { status: 404 });

  const caseData = CASES[room.case_id];
  if (!caseData) return NextResponse.json({ error: `Unknown case: ${room.case_id}.` }, { status: 500 });
  if (room.solved || room.current_stage > caseData.stages.length) {
    return NextResponse.json({ error: "This case is closed. There is nothing left to verify." }, { status: 400 });
  }
  const stage = caseData.stages.find((s) => s.stageNumber === room.current_stage);
  if (!stage) return NextResponse.json({ error: "Room stage does not match the case file." }, { status: 500 });
  if (stageNumber !== room.current_stage) {
    return NextResponse.json(
      { error: `This room is on stage ${room.current_stage}; stage ${stageNumber} submissions are not accepted.` },
      { status: 400 },
    );
  }

  const verdict = await judgeDeduction(
    { stageNumber: room.current_stage, culprit, chosenClueIds, explanationText },
    stage.verificationRubric,
    caseData.title,
  );

  const { error: logError } = await supabase.from("deduction_logs").insert({
    room_id: room.id,
    stage: room.current_stage,
    submitted_by: submittedBy,
    theory: explanationText,
    is_correct: verdict.isCorrect,
    feedback: verdict.feedback,
  });
  if (logError) console.error("[verify] deduction_logs insert failed:", logError.message);

  if (!verdict.isCorrect) {
    return NextResponse.json({
      isCorrect: false,
      feedback: verdict.feedback,
      unlockedEvidence: [] as string[],
      isGameComplete: false,
    });
  }

  const isFinal = room.current_stage === caseData.stages.length;
  const unlockedEvidence = isFinal ? [] : stage.unlocksEvidenceIds;

  // Conditional advance: a concurrent correct submission from a teammate
  // wins; if we lost the race the room already moved and was already broadcast.
  const patch: Record<string, unknown> = isFinal ? { solved: true } : { current_stage: room.current_stage + 1 };
  const { data: advanced, error: advError } = await supabase
    .from("rooms")
    .update(patch)
    .eq("id", room.id)
    .eq("current_stage", room.current_stage)
    .select();
  if (advError) return NextResponse.json({ error: advError.message }, { status: 500 });

  if (!advanced || advanced.length === 0) {
    const { data: reRoom } = await supabase.from("rooms").select("*").eq("id", room.id).maybeSingle();
    if (reRoom && (reRoom.solved || reRoom.current_stage > room.current_stage)) {
      return NextResponse.json({
        isCorrect: true,
        feedback: "The case has already advanced while you were filing — your deduction matched the file.",
        unlockedEvidence: [] as string[],
        isGameComplete: !!reRoom.solved,
      });
    }
  }

  if (!isFinal) {
    const { data: state } = await supabase
      .from("room_state")
      .select("unlocked_evidence")
      .eq("room_id", room.id)
      .maybeSingle();
    if (state) {
      const merged = [...state.unlocked_evidence];
      for (const id of unlockedEvidence) if (!merged.includes(id)) merged.push(id);
      const { error: unlockError } = await supabase
        .from("room_state")
        .update({ unlocked_evidence: merged })
        .eq("room_id", room.id);
      if (unlockError) console.error("[verify] unlock write failed:", unlockError.message);
    }
    try {
      await sendRoomBroadcast(room.code, {
        event: "stage_solved",
        payload: { stageNumber: room.current_stage + 1, unlockedEvidence },
      });
    } catch (e) {
      // Clients still converge via postgres_changes; the broadcast is a fast path.
      console.error("[verify] stage_solved broadcast failed:", (e as Error).message);
    }
  }

  return NextResponse.json({
    isCorrect: true,
    feedback: verdict.feedback,
    unlockedEvidence,
    isGameComplete: isFinal,
  });
}