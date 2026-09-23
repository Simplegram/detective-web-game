"use client";

import { useEffect, useRef, useState } from "react";
import { NotebookPen, X } from "lucide-react";

/**
 * Shared notebook drawer. Local edits call `onChange` (debounced 500ms by
 * the caller); remote edits from room_state replace the text only when the
 * field is not focused, so a typing detective is never clobbered mid-sentence.
 */
export function NotebookDrawer({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value);
  const focusedRef = useRef(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!focusedRef.current) setText(value);
  }, [value]);

  const handleInput = (t: string) => {
    setText(t);
    onChange(t);
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-stone-700/60 bg-noir-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-stone-700/60 px-5 py-3">
        <h2 className="font-display flex items-center gap-2 text-xl text-stone-100">
          <NotebookPen className="size-5 text-amber-400/80" />
          Shared Notebook
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1.5 text-stone-400 transition hover:bg-stone-800 hover:text-stone-100"
          aria-label="Close notebook"
        >
          <X className="size-5" />
        </button>
      </div>
      <p className="font-type px-5 pt-3 text-[11px] tracking-[0.25em] text-stone-500 uppercase">
        Autosaved for every detective in the room
      </p>
      <textarea
        ref={areaRef}
        value={text}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
        }}
        placeholder="What have we established so far? Theories, contradictions, who was where at what hour…"
        className="font-type m-5 flex-1 resize-none rounded-md border border-stone-700/60 bg-noir-850 p-4 text-sm leading-relaxed text-stone-200 outline-none placeholder:text-stone-600 focus:border-amber-500/50"
      />
    </aside>
  );
}