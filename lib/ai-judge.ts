/**
 * Deduction judge — grades a player's accusation for the current stage.
 *
 * Judge selection is driven purely by OPENAI_API_KEY (per the spec):
 *   - key set and not "sk-dummy…" → Chief Inspector Sterling as an LLM
 *     (gpt-4o-mini via the official OpenAI SDK).
 *   - key unset / dummy → deterministic mock evaluator (offline, zero-cost).
 *
 * Any LLM failure (timeout, unreachable, unparseable response) falls back to
 * the deterministic evaluator so verification never goes down.
 */
import OpenAI from "openai";
import type { EvaluationResult, FlawCategory, VerificationRubric } from "@/types";

export interface JudgeSubmission {
  stageNumber: number;
  culprit: string;
  chosenClueIds: string[];
  explanationText: string;
}

const LLM_TIMEOUT_MS = 30_000;
const LLM_MODEL = "gpt-4o-mini";
/** A reasoning must hit at least this many rubric keywords (mock mode). */
const KEYWORD_PASS = 2;
const FLAW_CATEGORIES: readonly FlawCategory[] = [
  "wrong_culprit",
  "wrong_evidence",
  "faulty_logic",
  "none",
];

/** True when a real OpenAI key is configured (not unset, not the dummy). */
export function useCloudJudge(): boolean {
  const key = (process.env.OPENAI_API_KEY ?? "").trim();
  return key.length > 0 && !key.startsWith("sk-dummy");
}

// ---------------------------------------------------------------------------
// Deterministic evaluator — the mock mode (offline, zero-cost)
// ---------------------------------------------------------------------------

export function evaluateDeterministic(
  sub: JudgeSubmission,
  rubric: VerificationRubric,
): EvaluationResult {
  const chosen = new Set(sub.chosenClueIds);
  const missing = rubric.requiredClueIds.filter((id) => !chosen.has(id));
  const text = sub.explanationText.toLowerCase();
  const hits = rubric.acceptedKeywords.filter((k) => text.includes(k.toLowerCase()));

  if (rubric.targetCulprit) {
    const a = sub.culprit.trim().toLowerCase();
    const b = rubric.targetCulprit.toLowerCase().trim();
    if (!a || (a !== b && !b.includes(a) && !a.includes(b))) {
      return {
        isCorrect: false,
        flawCategory: "wrong_culprit",
        feedback:
          "Your suspect does not align with the physical findings. Re-examine who had access and motive — and be certain your accusation answers what this stage actually asks you to prove.",
      };
    }
  }

  if (missing.length > 0) {
    return {
      isCorrect: false,
      flawCategory: "wrong_evidence",
      feedback:
        "Your theory lacks supporting documentation. You haven't cited the critical records that prove the contradiction — a detective arguing from memory alone is a witness, not an investigator.",
    };
  }

  if (hits.length < KEYWORD_PASS) {
    return {
      isCorrect: false,
      flawCategory: "faulty_logic",
      feedback:
        "You've pointed at the right files, but Inspector Sterling needs you to articulate specifically why these records conflict. Name the contradiction — the time, the place, the impossibility.",
    };
  }

  return {
    isCorrect: true,
    flawCategory: "none",
    feedback:
      "Accepted. You've pinned the lie to the evidence and shown precisely where the records contradict one another. That is how a case gets closed, Detective.",
  };
}

// ---------------------------------------------------------------------------
// LLM evaluator (gpt-4o-mini via the official OpenAI SDK)
// ---------------------------------------------------------------------------

function systemPrompt(title: string, stage: number): string {
  return [
    `You are Chief Inspector Sterling of Scotland Yard, head of the Cold Case Archives. You debrief junior detectives on their deductions in the case "${title}" (stage ${stage}).`,
    "You receive a confidential grading rubric and the detective's submission.",
    'Set "isCorrect" to true ONLY if the deduction (a) names the target where one is defined, (b) cites the required evidence, and (c) articulates the key contradiction in substance — parroting keywords without grasping the contradiction is a failure.',
    'When "isCorrect" is false, NEVER reveal the answer, the target, or the key contradiction verbatim. Give a short, in-character, constructive hint that nudges the detective in the right direction without solving it for them.',
    '"feedback" is your in-character debrief (2-4 sentences).',
    '"flawCategory" is the dominant flaw: "wrong_culprit", "wrong_evidence", "faulty_logic", or "none".',
    'Respond with ONLY a JSON object: {"isCorrect": boolean, "feedback": string, "flawCategory": string}',
  ].join("\n");
}

function userPrompt(sub: JudgeSubmission, rubric: VerificationRubric): string {
  return [
    "RUBRIC (confidential — never repeat it verbatim):",
    `- Target: ${rubric.targetCulprit ?? "(none — this stage tests a deduction, not a culprit)"}`,
    `- Key contradiction: ${rubric.criticalContradiction}`,
    `- Required evidence IDs: ${rubric.requiredClueIds.join(", ")}`,
    "",
    "DETECTIVE'S SUBMISSION:",
    `- Accused: ${sub.culprit}`,
    `- Evidence cited: ${sub.chosenClueIds.join(", ") || "(none)"}`,
    `- Deductive reasoning: ${sub.explanationText}`,
  ].join("\n");
}

/** Strip  reasoning and extract a JSON object, leniently. */
export function parseEvaluation(raw: string): EvaluationResult {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON object in LLM response");
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const isCorrect = obj.isCorrect === true;
  const feedback =
    typeof obj.feedback === "string" && obj.feedback.trim()
      ? obj.feedback.trim()
      : "The Inspector declines to comment.";
  const flaw = FLAW_CATEGORIES.includes(obj.flawCategory as FlawCategory)
    ? (obj.flawCategory as FlawCategory)
    : "none";
  return { isCorrect, feedback, flawCategory: flaw };
}

export async function evaluateWithLLM(
  sub: JudgeSubmission,
  rubric: VerificationRubric,
  caseTitle: string,
): Promise<EvaluationResult> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: LLM_TIMEOUT_MS,
    maxRetries: 0,
  });

  const res = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt(caseTitle, sub.stageNumber) },
      { role: "user", content: userPrompt(sub, rubric) },
    ],
  });
  const raw = res.choices[0]?.message?.content ?? "";
  if (!raw.trim()) throw new Error("empty completion");
  return parseEvaluation(raw);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function judgeDeduction(
  sub: JudgeSubmission,
  rubric: VerificationRubric,
  caseTitle = "the open case",
): Promise<EvaluationResult> {
  if (useCloudJudge()) {
    try {
      return await evaluateWithLLM(sub, rubric, caseTitle);
    } catch (e) {
      console.warn(
        `[Judge] OpenAI evaluation failed (${(e as Error).message ?? e}); ` +
          `falling back to the deterministic mock.`,
      );
    }
  }
  return evaluateDeterministic(sub, rubric);
}