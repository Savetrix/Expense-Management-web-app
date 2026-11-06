"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ChatPanel } from "@/components/chatbot/ChatPanel";
import { clearChat } from "@/store/chat/chatSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

// Mounted in AppShell's header (see architecture doc §6.1) so it only ever
// renders once the user is authenticated, next to the other global,
// always-available header affordances (GlobalSearchBar, notifications).
export function ChatWidget({ companyName }: { companyName?: string }) {
  const dispatch = useAppDispatch();
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const [open, setOpen] = useState(false);
  const previousQbConnectionId = useRef(qbConnectionId);

  // A conversation started while looking at Company A's data must not keep
  // answering as if it's still Company A after the user switches companies
  // via the header switcher — this is specific to this app's multi-company
  // model, not something sessionBoundary.ts already covers (architecture
  // doc §5, §7.8). Skips the very first render so a fresh connection load
  // doesn't clear a conversation that was never stale.
  useEffect(() => {
    if (previousQbConnectionId.current && previousQbConnectionId.current !== qbConnectionId) {
      dispatch(clearChat());
    }
    previousQbConnectionId.current = qbConnectionId;
  }, [qbConnectionId, dispatch]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open chat assistant (beta)"
        title="Chat assistant (beta)"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-text-secondary hover:bg-background-alt"
      >
        <MessageCircle size={18} strokeWidth={2} />
      </button>

      {open && (
        <>
          {/* Backdrop is click-to-close only — no focus trap library in this
              repo yet, so Escape (handled inside ChatPanel) is the primary
              keyboard dismissal path, matching DialogHost's confirm dialog. */}
          <div className="fixed inset-0 z-[80] bg-black/20" onClick={() => setOpen(false)} />
          <ChatPanel companyName={companyName} onClose={() => setOpen(false)} />
        </>
      )}
    </>
  );
}
