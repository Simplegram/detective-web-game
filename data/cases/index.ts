/**
 * Dynamic case registry.
 *
 * Every `data/cases/*.json` file is registered automatically — drop a new
 * case file on disk (see scripts/generate-case.ts) and it is selectable on
 * the landing page with no code changes.
 *
 * JSON imports lose literal unions, so each raw file is cast once here and
 * consumers import from this module instead.
 */
import type { CaseData, Difficulty } from "@/types";

export const DEFAULT_CASE_ID = "case-blackwood-manor";

/** Eager glob of all case files; paths look like "./blackwood-manor.json". */
const caseModules = import.meta.glob("./*.json", { eager: true });

function toCaseData(mod: unknown): CaseData | null {
  // Eager JSON modules surface as { default: data }; tolerate a bare value too.
  const raw =
    rawValue(mod) != null ? rawValue(mod) : (mod as CaseData | null);
  if (!raw || typeof raw !== "object") return null;
  const data = raw as CaseData;
  if (!data.id || !data.title || !Array.isArray(data.documents)) return null;
  return data;
}

function rawValue(mod: unknown): unknown {
  return typeof mod === "object" && mod !== null && "default" in mod
    ? (mod as { default: unknown }).default
    : null;
}

const byFile: Record<string, CaseData> = {};
for (const [path, mod] of Object.entries(caseModules)) {
  const data = toCaseData(mod);
  if (data) byFile[path] = data;
}

/** Registry of available cases, keyed by the `case_id` stored on rooms. */
export const CASES: Record<string, CaseData> = {};
for (const data of Object.values(byFile)) CASES[data.id] = data;

/** Light per-case summary for the landing-page case shelf. */
export interface CaseSummary {
  id: string;
  title: string;
  synopsis: string;
  difficulty: Difficulty;
  /** Display string, e.g. "≈ 45 min" (falls back to 45 when unset). */
  estimatedTime: string;
  victim: string;
  victimDescription?: string;
  tags?: string[];
  totalStages: number;
  documentCount: number;
}

/** All registered cases, light enough for the UI (no document bodies). */
export function getAllCaseSummaries(): CaseSummary[] {
  return Object.values(CASES).map((c) => ({
    id: c.id,
    title: c.title,
    synopsis: c.synopsis,
    difficulty: c.difficulty,
    estimatedTime: `≈ ${c.estimatedMinutes ?? 45} min`,
    victim: c.victim.name,
    victimDescription: c.victim.description,
    tags: c.tags,
    totalStages: c.stages.length,
    documentCount: c.documents.length,
  }));
}

/** Full typed case data, or null when the id is not registered. */
export function getCaseById(id: string): CaseData | null {
  return CASES[id] ?? null;
}

/** Case for a room's case_id, falling back to the default case file. */
export function resolveCase(id?: string | null): CaseData {
  return (id && CASES[id]) || CASES[DEFAULT_CASE_ID];
}

/** Documents visible in a fresh room at a given stage. */
export function initialEvidenceIds(c: CaseData): string[] {
  return c.documents.filter((d) => d.initialStage === 1).map((d) => d.id);
}