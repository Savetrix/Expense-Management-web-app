"use client";

import { AlertTriangle, Bell, CheckCircle2, Info, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  NOTIFICATIONS_CHANGED,
  NotificationItem,
  dialogEmitter,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/dialogManager";

const NOTIFICATION_ICON = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const NOTIFICATION_ICON_CLASS = {
  success: "text-success",
  error: "text-error",
  warning: "text-warning",
  info: "text-trust-navy",
} as const;

function formatRelativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}


// Reads/writes the same in-memory history dialogManager.ts builds from every
// showToast() call — QuickBooks sync, vendor/GL/tax-code sync, invoices,
// auth, etc. — so this dropdown is a live log of everything the app has
// already been telling the user via toast, not a separate feed to keep wired
// up per feature.
export function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const seeded = getNotifications();
    setNotifications(seeded);

    const onChange = (next: NotificationItem[]) => setNotifications(next);
    dialogEmitter.on(NOTIFICATIONS_CHANGED, onChange);
    return () => {
      dialogEmitter.off(NOTIFICATIONS_CHANGED, onChange);
    };
  }, []);

  // No preview bubble here any more. DialogHost renders every showToast() as
  // a bottom-corner toast above the dialog layer, from a host that is mounted
  // on every route — this bubble sat at the same z-index as the confirm
  // dialog's backdrop and was invisible on exactly the flows that needed it,
  // and it never rendered at all on the shell-less auth routes. The bell keeps
  // the scrollback and the unread count.

  // Relative timestamps ("2m ago") depend on the current time, which must
  // not be read during the initial server/client render (hydration
  // mismatch) — computed after mount instead, same guard other
  // client-only-value reads use elsewhere in this app.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Opening the dropdown is the "I've seen these" signal — no separate
  // mark-all-read click needed.
  const handleToggle = () => {
    setOpen((prevOpen) => {
      const nextOpen = !prevOpen;
      if (nextOpen) markAllNotificationsRead();
      return nextOpen;
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        onClick={handleToggle}
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-text-secondary hover:bg-background-alt"
      >
        <Bell size={18} strokeWidth={2} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>


      {open && (
        <div className="absolute right-0 top-12 z-[100] flex max-h-96 w-80 flex-col overflow-hidden rounded-lg border border-border bg-white shadow-xl">
          <div className="flex shrink-0 items-center border-b border-border px-[var(--space-md)] py-[var(--space-sm)]">
            <h3 className="text-body-sm font-bold text-text-primary">Notifications</h3>
          </div>

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-[var(--space-md)] py-[var(--space-lg)] text-center text-body-sm text-text-secondary">
                No notifications yet.
              </p>
            ) : (
              notifications.map((notification) => {
                const Icon = NOTIFICATION_ICON[notification.tone];
                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => markNotificationRead(notification.id)}
                    className={`flex w-full items-start gap-[var(--space-sm)] border-b border-border px-[var(--space-md)] py-[var(--space-sm)] text-left last:border-b-0 hover:bg-background-alt ${
                      notification.read ? "" : "bg-primary-50/50"
                    }`}
                  >
                    <Icon size={16} strokeWidth={2} className={`mt-0.5 shrink-0 ${NOTIFICATION_ICON_CLASS[notification.tone]}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-body-sm text-text-primary">{notification.message}</p>
                      <p className="mt-0.5 text-caption text-text-secondary">
                        {now === null ? "" : formatRelativeTime(notification.timestamp, now)}
                      </p>
                    </div>
                    {!notification.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-500" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
