"use client";

import { useRef, type MouseEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import type { CaseDocument, EvidencePing } from "@/types";

function CoffeeStain() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 120 120"
      className="pointer-events-none absolute opacity-[0.14] mix-blend-multiply"
      style={{ width: 190, height: 190, right: "-24px", bottom: "-18px" }}
    >
      <ellipse cx="60" cy="60" rx="52" ry="46" fill="none" stroke="#6b4a2b" strokeWidth="7" />
      <ellipse cx="60" cy="60" rx="44" ry="38" fill="none" stroke="#6b4a2b" strokeWidth="2" />
      <path d="M108 74c14 6 22 18 18 30" stroke="#6b4a2b" strokeWidth="7" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function DocumentViewer({
  doc,
  pings,
  onPing,
  onClose,
}: {
  doc: CaseDocument;
  /** Pings for this document only. */
  pings: EvidencePing[];
  onPing: (docId: string, x: number, y: number) => void;
  onClose: () => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  const handleDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = surfaceRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    onPing(doc.id, x, y);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/85 p-4">
      <div className="relative flex h-full max-h-[92vh] w-full max-w-3xl flex-col">
        {/* Folder tab */}
        <div className="absolute -top-3 left-10 h-6 w-52 rounded-t-md bg-[#d9c9a3]" />
        <div className="manila-card relative flex h-full flex-col overflow-hidden rounded-lg">
          {/* Header strip */}
          <div className="flex items-center justify-between gap-4 border-b-2 border-stone-900/30 px-6 py-3">
            <div className="min-w-0">
              <p className="font-type text-[10px] tracking-[0.3em] text-stone-600 uppercase">
                {doc.fileNumber} · {doc.classification}
              </p>
              <h2 className="font-display truncate text-2xl text-stone-900">
                {doc.title}
              </h2>
            </div>
            <span className="stamp font-type shrink-0 px-3 py-1 text-xs font-bold text-blood">
              {doc.classification}
            </span>
          </div>

          {/* Typed report surface (double-click anywhere = ping) */}
          <div
            ref={surfaceRef}
            onDoubleClick={handleDoubleClick}
            className="relative min-h-0 flex-1 cursor-crosshair overflow-y-auto bg-[#f4ecd8] px-8 py-6 sm:px-12"
          >
            <CoffeeStain />
            <div className="relative max-w-prose">
              <p className="font-type mb-6 border-b border-stone-900/40 pb-3 text-center text-xs tracking-[0.3em] text-stone-700 uppercase">
                Cold Case Archives · Office of the Chief Constable
              </p>
              <ReportBody content={doc.content} />
              <p className="font-type mt-8 text-center text-[10px] tracking-[0.25em] text-stone-500 uppercase">
                — end of record {doc.fileNumber} —
              </p>
            </div>

            {/* Evidence ping overlay */}
            {pings.map((ping) => (
              <span
                key={ping.id}
                className="pointer-events-none absolute"
                style={{ left: `${ping.x * 100}%`, top: `${ping.y * 100}%` }}
              >
                <span className="ping-target block size-10 rounded-full border-2 border-blood-bright shadow-[0_0_12px_rgba(192,58,58,0.7)]" />
                <span className="font-type absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-stone-900/90 px-2 py-0.5 text-[10px] tracking-[0.15em] text-amber-100 uppercase">
                  {ping.senderName}
                </span>
              </span>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 border-t-2 border-stone-900/30 bg-[#e7d9b8] px-6 py-2.5">
            <p className="font-type text-[11px] tracking-[0.2em] text-stone-600 uppercase">
              Double-click the page to ping your partners here
            </p>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 rounded bg-stone-900 px-3 py-1.5 text-xs tracking-[0.15em] text-amber-100 uppercase transition hover:bg-stone-800"
            >
              <X className="size-3.5" /> File away
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Minimal markdown-ish renderer: headings, bold, lists, tables, blockquotes, paragraphs. */
function ReportBody({ content }: { content: string }) {
  const lines = content.split("\n");
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[][] | null = null;

  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? "ol" : "ul";
      out.push(
        <Tag
          key={`l${out.length}`}
          className={`font-type my-3 space-y-1 text-[15px] text-stone-800 ${
            list.ordered ? "list-decimal pl-6" : "list-none"
          }`}
        >
          {list.items.map((it, i) => (
            <li key={i}>{inline(it)}</li>
          ))}
        </Tag>
      );
      list = null;
    }
  };
  const flushTable = () => {
    if (table) {
      const [head, ...rows] = table;
      out.push(
        <div key={`t${out.length}`} className="font-type my-4 overflow-x-auto text-[13px]">
          <table className="w-full border-collapse">
            <tbody>
              {head && (
                <tr>
                  {head.map((c, i) => (
                    <th
                      key={i}
                      className="border border-stone-900/40 bg-stone-900/10 px-3 py-1.5 text-left text-stone-800"
                    >
                      {inline(c)}
                    </th>
                  ))}
                </tr>
              )}
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-stone-900/40 px-3 py-1.5 text-stone-800">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      table = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      flushTable();
      continue;
    }
    if (line.startsWith("|")) {
      flushList();
      if (/^\|[\s:|-]+\|$/.test(line)) continue; // separator row
      const cells = line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      table = table ?? [];
      table.push(cells);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      flushTable();
      out.push(
        <h3
          key={`h${out.length}`}
          className="font-display mb-2 mt-5 text-lg text-stone-900 uppercase"
        >
          {h[2]}
        </h3>
      );
      continue;
    }
    const ul = line.match(/^[-*]\s+(.*)$/);
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushTable();
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    flushList();
    flushTable();
    if (line.startsWith("> ")) {
      out.push(
        <p key={`q${out.length}`} className="font-type my-3 border-l-4 border-stone-900/30 pl-4 text-[15px] text-stone-700 italic">
          {inline(line.slice(2))}
        </p>
      );
    } else {
      out.push(
        <p key={`p${out.length}`} className="font-type my-3 text-[15px] leading-relaxed text-stone-800">
          {inline(line)}
        </p>
      );
    }
  }
  flushList();
  flushTable();
  return <>{out}</>;
}

function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-stone-900">
        {p.slice(2, -2)}
      </strong>
    ) : (
      p
    )
  );
}