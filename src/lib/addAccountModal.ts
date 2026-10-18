// Opens the shell's "Add an accounting account" modal — the one behind the
// header's company switcher → "Add account" — from anywhere in the app. The
// modal and its connect flow (slot check, OAuth redirect) live in AppShell,
// which every signed-in page renders inside; this lets a page offer the same
// entry point without duplicating any of it.
import EventEmitter from "eventemitter3";

const emitter = new EventEmitter();
const OPEN = "OPEN_ADD_ACCOUNT_MODAL";

export const openAddAccountModal = (): void => {
  emitter.emit(OPEN);
};

export const onOpenAddAccountModal = (handler: () => void): (() => void) => {
  emitter.on(OPEN, handler);
  return () => {
    emitter.off(OPEN, handler);
  };
};
