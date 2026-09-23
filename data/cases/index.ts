/**
 * Typed accessor for static case data.
 * JSON imports lose literal unions, so the raw file is cast once here and
 * consumers import from this module instead.
 */
import type { CaseData } from "@/types";
import raw from "./blackwood-manor.json";

export const blackwoodManorCase: CaseData = raw as CaseData;

/** Registry of available cases, keyed by the `case_id` stored on rooms. */
export const CASES: Record<string, CaseData> = {
  [blackwoodManorCase.id]: blackwoodManorCase,
};