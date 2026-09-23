import { FolderOpen } from "lucide-react";

export default function RoomLoading() {
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