/**
 * Cold Case Archives — shared type definitions.
 * Case content types mirror /data/cases/[caseId].json;
 * Room/RoomState mirror the Supabase schema (see scripts/setup-db.ts).
 */

// ---------------------------------------------------------------------------
// Static case data
// ---------------------------------------------------------------------------

export type Difficulty = "Easy" | "Medium" | "Hard";

export type DocumentCategory = "forensic" | "interrogation" | "evidence" | "timeline";

export type Classification = "CONFIDENTIAL" | "UNRESTRICTED";

export interface Victim {
  name: string;
  age: number;
  occupation: string;
  photoUrl: string;
}

/** Criteria the LLM judge (POST /api/verify) uses to grade a deduction. */
export interface VerificationRubric {
  /** Expected culprit name; omitted for stages that test a non-culprit deduction. */
  targetCulprit?: string;
  /** The core logical contradiction a correct deduction must identify. */
  criticalContradiction: string;
  /** Document IDs a sound deduction must cite. */
  requiredClueIds: string[];
  /** Substring markers a correct reasoning should hit (deterministic fallback). */
  acceptedKeywords: string[];
}

export interface CaseStage {
  stageNumber: number;
  title: string;
  objective: string;
  description: string;
  /** Documents unlocked into the shared room state when this stage is solved. */
  unlocksEvidenceIds: string[];
  verificationRubric: VerificationRubric;
}

export interface Suspect {
  name: string;
  role: string;
}

export interface CaseDocument {
  id: string;
  title: string;
  category: DocumentCategory;
  fileNumber: string;
  classification: Classification;
  /** Markdown-flavored body text of the typed report. */
  content: string;
  mediaUrl?: string;
  /** Stage number at which the document is visible in newly created rooms. */
  initialStage: number;
}

export interface CaseData {
  id: string;
  title: string;
  synopsis: string;
  difficulty: Difficulty;
  victim: Victim;
  stages: CaseStage[];
  documents: CaseDocument[];
  suspects: Suspect[];
}

// ---------------------------------------------------------------------------
// Live room state (Supabase tables)
// ---------------------------------------------------------------------------

export interface Room {
  id: string;
  code: string;
  case_id: string;
  current_stage: number;
  solved: boolean;
  created_at: string;
}

export type PinType = "suspect" | "photo" | "note" | "evidence";

export interface CorkboardPin {
  id: string;
  type: PinType;
  /** Position as percentage of board width/height. */
  x: number;
  y: number;
  label: string;
  connectedTo: string[];
  /** Player name who last placed or moved this pin. */
  by?: string;
}

export interface RoomState {
  room_id: string;
  unlocked_evidence: string[];
  shared_notes: string;
  corkboard_pins: CorkboardPin[];
  last_updated_by: string | null;
  updated_at: string;
}

/** Verdict produced by the judge (LLM or deterministic fallback). */
export type FlawCategory = "wrong_culprit" | "wrong_evidence" | "faulty_logic" | "none";

export interface EvaluationResult {
  isCorrect: boolean;
  /** In-character debriefing from Chief Inspector Sterling. */
  feedback: string;
  flawCategory?: FlawCategory;
}

/** Row of `deduction_logs` — the shared case log. */
export interface DeductionLog {
  id: string;
  room_id: string;
  stage: number;
  submitted_by: string;
  theory: string;
  is_correct: boolean;
  feedback: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Realtime channel payloads (broadcast on channel `room:${code}`)
// ---------------------------------------------------------------------------

/** Heartbeat identity as seen by other players (presence is heartbeat-derived). */
export interface PlayerPresence {
  id: string;
  name: string;
  activeDocId: string | null;
  lastSeen: number;
}

export type BroadcastEvent =
  | { event: "heartbeat"; payload: PlayerPresence }
  | {
      event: "ping";
      payload: { docId: string; x: number; y: number; senderName: string };
    }
  | {
      event: "stage_solved";
      payload: { stageNumber: number; unlockedEvidence: string[] };
    };

/** Ephemeral ping marker rendered on top of an open document. */
export interface EvidencePing {
  id: string;
  docId: string;
  x: number;
  y: number;
  senderName: string;
  at: number;
}