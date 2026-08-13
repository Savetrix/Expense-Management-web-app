// Same singleton-emitter pattern as sessionManager.ts's sessionEmitter — a
// plain module (not a component) can trigger a dialog/toast from anywhere
// (event handlers, hooks like useLogout) without needing React context
// plumbing at every call site. src/components/ui/DialogHost.tsx is the one
// mounted subscriber that turns these events into rendered UI.
import EventEmitter from "eventemitter3";

export type DialogTone = "default" | "destructive";
export type ToastTone = "success" | "error" | "info";

export interface ConfirmRequest {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Optional third, non-destructive action — renders between Cancel and the
   *  confirm button and resolves the promise with "alt" instead of a boolean.
   *  Used for "Reconnect instead" on the disconnect dialog (disconnect +
   *  reconnect is the token-refresh path) without giving up the blocking
   *  confirm contract. */
  altLabel?: string;
  tone: DialogTone;
  resolve: (value: boolean | "alt") => void;
}

export type ConfirmResult = boolean | "alt";

export interface NotificationItem {
  id: number;
  message: string;
  tone: ToastTone;
  timestamp: number;
  read: boolean;
}

export const dialogEmitter = new EventEmitter();

export const CONFIRM_REQUEST = "CONFIRM_REQUEST";
export const NOTIFICATIONS_CHANGED = "NOTIFICATIONS_CHANGED";

// showToast() only ever renders as a notification-bar entry (NotificationBell's
// preview bubble + dropdown history) — there is no separate bottom-corner
// toast anymore, so every call shows up exactly once. Capped, in-memory only
// — no persistence across a page reload.
const MAX_NOTIFICATIONS = 30;
let notifications: NotificationItem[] = [];

let nextId = 0;

// Replaces window.confirm — preserves the same blocking-until-dismissed
// contract (callers `await` this exactly like they awaited the synchronous
// window.confirm return value) but resolves on the themed dialog's button
// click instead of a native browser dialog.
interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  altLabel?: string;
  tone?: DialogTone;
}

// Overloaded on purpose. Adding the third button widened the result to
// `boolean | "alt"`, and "alt" is TRUTHY — so a caller doing `if (confirmed)`
// would treat "the user picked the other option" as "the user said yes". Two
// of those call sites authorize destructive work (the chatbot's consent gate
// and post-to-QuickBooks). Rather than rely on every present and future
// caller remembering to compare against `true`, the boolean stays the type
// unless you explicitly opt into an alt button.
export function confirmDialog(options: ConfirmDialogOptions & { altLabel: string }): Promise<ConfirmResult>;
export function confirmDialog(options: ConfirmDialogOptions & { altLabel?: never }): Promise<boolean>;
export function confirmDialog(options: ConfirmDialogOptions): Promise<ConfirmResult> {
  return new Promise((resolve) => {
    const request: ConfirmRequest = {
      id: ++nextId,
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? "Confirm",
      cancelLabel: options.cancelLabel ?? "Cancel",
      altLabel: options.altLabel,
      tone: options.tone ?? "default",
      resolve,
    };
    dialogEmitter.emit(CONFIRM_REQUEST, request);
  });
}

// Replaces window.alert for non-confirmation notices (success/error/info).
// Surfaces solely through NotificationBell's preview bubble + dropdown
// history (auto-dismisses there same as a toast would), unlike a
// confirmation which must stay until the user decides. See
// DESIGN_ASSUMPTIONS.md D1.3.
export function showToast(message: string, tone: ToastTone = "info"): void {
  const id = ++nextId;
  notifications = [{ id, message, tone, timestamp: Date.now(), read: false }, ...notifications].slice(
    0,
    MAX_NOTIFICATIONS
  );
  dialogEmitter.emit(NOTIFICATIONS_CHANGED, notifications);
}

export function getNotifications(): NotificationItem[] {
  return notifications;
}

export function markNotificationRead(id: number): void {
  notifications = notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
  dialogEmitter.emit(NOTIFICATIONS_CHANGED, notifications);
}

export function markAllNotificationsRead(): void {
  notifications = notifications.map((n) => ({ ...n, read: true }));
  dialogEmitter.emit(NOTIFICATIONS_CHANGED, notifications);
}
