import { Spinner } from "./Spinner";

export function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-[var(--space-md)] bg-background-soft">
      <Spinner size="lg" />
      <p className="text-body-sm font-medium text-text-secondary">Loading…</p>
    </div>
  );
}
