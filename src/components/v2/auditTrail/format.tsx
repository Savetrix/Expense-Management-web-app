import { Bot, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/v2/ui";

import type { AuditEvent } from "./mockData";

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(diff / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Fills the "{provider}" placeholder in mock copy with the active accounting software. */
export const withProvider = (text: string, providerName: string) => text.replaceAll("{provider}", providerName);

export function ActorCell({ event }: { event: AuditEvent }) {
  if (event.actorType === "autopilot") {
    return (
      <Badge variant="success" className="gap-[var(--space-xs)]">
        <Bot size={12} strokeWidth={2.25} />
        Autopilot
      </Badge>
    );
  }
  if (event.actorType === "assistant") {
    return (
      <Badge variant="warning" className="gap-[var(--space-xs)]">
        <Sparkles size={12} strokeWidth={2.25} />
        AI assistant
      </Badge>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-[var(--space-sm)]">
      <Avatar name={event.actorName} size="sm" />
      <span className="truncate font-semibold">{event.actorName}</span>
    </span>
  );
}
