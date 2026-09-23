/**
 * POST /api/rooms
 * Body: { caseId?: string }
 *
 * Provisions a room: allocates a unique 6-char code, stores `case_id`
 * (validated against the case registry — unknown ids are rejected with
 * the list of available cases), and seeds `room_state.unlocked_evidence`
 * with the selected case's Stage-1 documents. Omitting caseId uses the
 * default case.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  CASES,
  DEFAULT_CASE_ID,
  getCaseById,
  initialEvidenceIds,
} from "@/data/cases";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

function generateRoomCode(): string {
  return Array.from({ length: CODE_LENGTH }, () =>
    CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  ).join("");
}

export async function POST(req: NextRequest) {
  let caseId: string;
  try {
    const body = (await req.json()) as { caseId?: unknown };
    caseId = typeof body?.caseId === "string" ? body.caseId.trim() : "";
  } catch {
    caseId = ""; // tolerate an empty body
  }

  let activeCaseId = DEFAULT_CASE_ID;
  if (caseId) {
    if (!getCaseById(caseId)) {
      return NextResponse.json(
        {
          error: `Unknown case "${caseId}". Available: ${Object.keys(CASES).join(", ")}.`,
        },
        { status: 400 }
      );
    }
    activeCaseId = caseId;
  }

  const supabase = getSupabaseServer();
  const caseData = getCaseById(activeCaseId)!;
  const initialEvidence = initialEvidenceIds(caseData);

  for (let attempt = 0; attempt < 4; attempt++) {
    const code = generateRoomCode();
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .insert({ code, case_id: activeCaseId })
      .select()
      .single();
    if (roomError) {
      if (roomError.code === "23505") continue; // code collision, retry
      return NextResponse.json({ error: roomError.message }, { status: 500 });
    }
    const { error: stateError } = await supabase.from("room_state").insert({
      room_id: room.id,
      unlocked_evidence: initialEvidence,
      shared_notes: "",
    });
    if (stateError) {
      return NextResponse.json({ error: stateError.message }, { status: 500 });
    }
    return NextResponse.json({ code: room.code, caseId: activeCaseId });
  }
  return NextResponse.json(
    { error: "Could not allocate a room code after several attempts." },
    { status: 503 }
  );
}