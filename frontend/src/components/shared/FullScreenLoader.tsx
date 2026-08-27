import { ShieldHalf } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";

// Shown for two brief windows: (1) while AuthContext silently restores a
// session from the persisted refresh token on page load, and (2) while a
// lazy-loaded route chunk is still downloading. Same brand mark as the
// Login page and Sidebar (ShieldHalf + "Sentinel") so neither moment reads
// as a broken or blank page — it's recognizably still Sentinel, just
// catching up.
export function FullScreenLoader() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--bg-canvas)] px-6">
      <div className="flex items-center gap-2.5">
        <ShieldHalf className="h-7 w-7 animate-pulse text-[var(--color-brand)]" />
        <span className="text-xl font-semibold tracking-tight">CamOps</span>
      </div>
      <div className="w-full max-w-xs space-y-2">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}
