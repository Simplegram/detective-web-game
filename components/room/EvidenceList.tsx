"use client";

import {
  BookOpenText,
  FileText,
  Fingerprint,
  Lock,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { blackwoodManorCase as caseData } from "@/data/cases";
import type { CaseDocument, DocumentCategory } from "@/types";

const CATEGORY_ICON: Record<DocumentCategory, LucideIcon> = {
  forensic: Fingerprint,
  interrogation: ScrollText,
  evidence: FileText,
  timeline: BookOpenText,
};

const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  forensic: "Forensic",
  interrogation: "Interrogation",
  evidence: "Evidence",
  timeline: "Timeline",
};

export function EvidenceList({
  unlockedIds,
  totalDocs,
  onOpen,
  onLocked,
}: {
  unlockedIds: string[];
  totalDocs: number;
  onOpen: (doc: CaseDocument) => void;
  onLocked?: (doc: CaseDocument) => void;
}) {
  const unlockedSet = new Set(unlockedIds);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {caseData.documents.map((doc) => {
        const Icon = CATEGORY_ICON[doc.category];
        const isUnlocked = unlockedSet.has(doc.id);
        return (
          <button
            key={doc.id}
            type="button"
            onClick={() => (isUnlocked ? onOpen(doc) : onLocked?.(doc))}
            className="group relative rounded-lg border border-stone-700/60 bg-noir-850 p-4 text-left transition hover:border-amber-500/50"
          >
            <div className="flex items-start justify-between gap-3">
              <Icon
              className={`mt-0.5 size-5 shrink-0 ${
                  isUnlocked ? "text-amber-400/80" : "text-stone-600"
                }`}
              />
              <span className="font-type text-[10px] tracking-[0.2em] text-stone-500">
                {doc.fileNumber}
              </span>
            </div>
            <h3
              className={`font-display mt-3 text-lg leading-snug ${
                isUnlocked ? "text-stone-100" : "text-stone-500"
              }`}
            >
              {isUnlocked ? doc.title : "SEALED FILE"}
            </h3>
            <p className="font-type mt-1 text-[11px] tracking-[0.15em] uppercase">
              {CATEGORY_LABEL[doc.category]}
              {" · "}
              {doc.classification}
            </p>
            {!isUnlocked && (
              <span className="stamp font-type absolute right-3 bottom-3 px-2 py-0.5 text-[10px] font-bold text-stone-600">
                <Lock className="mr-1 inline size-3" />
                STAGE {doc.initialStage}
              </span>
            )}
          </button>
        );
      })}
      <p className="font-type col-span-full text-xs text-stone-600">
        {unlockedSet.size} of {totalDocs} case files unsealed — solve each stage
        to break the seals.
      </p>
    </div>
  );
}