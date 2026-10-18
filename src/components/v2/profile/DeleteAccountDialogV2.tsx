"use client";

import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal, TextInput } from "@/components/v2/ui";
import {
  DELETION_CONFIRM_TEXT,
  DeletionPreview,
  describeDeletionImpact,
  isDeletionConfirmTextValid,
  storeCancellationWarning,
} from "@/lib/accountDeletion";
import { showToast } from "@/lib/dialogManager";
import { deleteAccount, fetchDeletionPreview, logoutUser } from "@/store/auth/authApi";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

// GitHub-style typed confirmation: the dialog first loads what deleting
// would close (companies, team members, subscription) so the user sees the
// real consequences, then only enables Delete once they've typed the phrase.
// Mounted only while open, so the preview is fetched fresh each time.
export function DeleteAccountDialogV2({ onClose }: { onClose: () => void }) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const refreshToken = useAppSelector((state) => state.auth.user?.data?.refreshToken);

  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    dispatch(fetchDeletionPreview()).then((result) => {
      if (cancelled) return;
      if (fetchDeletionPreview.fulfilled.match(result)) setPreview(result.payload);
      else setPreviewError(typeof result.payload === "string" ? result.payload : "Could not load account details");
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const confirmText = preview?.confirmText || DELETION_CONFIRM_TEXT;
  const canDelete = !!preview && !isDeleting && isDeletionConfirmTextValid(typed, confirmText);
  const storeWarning = preview ? storeCancellationWarning(preview) : null;

  // Closing mid-request would leave the user on a page whose session is
  // about to disappear underneath it.
  const close = () => {
    if (!isDeleting) onClose();
  };

  const handleDelete = async () => {
    if (!canDelete) return;
    setIsDeleting(true);
    const result = await dispatch(deleteAccount({ confirmText: typed }));
    if (!deleteAccount.fulfilled.match(result)) {
      setIsDeleting(false);
      showToast(typeof result.payload === "string" ? result.payload : "Could not delete your account", "error");
      return;
    }
    // The account and its tokens are gone server-side. logoutUser clears
    // local storage and resets every session-scoped slice either way —
    // fulfilled or rejected — so the outcome of its own request doesn't matter.
    await dispatch(logoutUser({ refreshToken: refreshToken ?? "" }));
    router.replace("/login?accountDeleted=true");
  };

  return (
    <Modal
      open
      onClose={close}
      title="Delete account"
      widthClassName="max-w-lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={close} disabled={isDeleting}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={handleDelete} disabled={!canDelete} loading={isDeleting}>
            {isDeleting ? "Deleting…" : "Delete my account"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--space-md)]">
        <div className="flex items-start gap-[var(--space-sm)] rounded-md border border-status-danger-border bg-status-danger-bg p-[var(--space-md)]">
          <AlertTriangle size={20} strokeWidth={2} className="mt-0.5 shrink-0 text-status-danger-text" />
          <p className="text-body-sm font-semibold text-status-danger-text">
            This deletes your account and can&apos;t be undone from the app.
          </p>
        </div>

        {!preview && !previewError && <p className="text-body-sm text-content-secondary">Loading account details…</p>}

        {previewError && (
          <p className="text-body-sm font-medium text-status-danger-text">
            {previewError}. Close this and try again.
          </p>
        )}

        {preview && (
          <>
            <div>
              <p className="mb-[var(--space-xs)] text-body-sm font-semibold text-content-primary">What will happen</p>
              <ul className="flex list-disc flex-col gap-[var(--space-xs)] pl-[var(--space-lg)] text-body-sm text-content-secondary">
                {describeDeletionImpact(preview).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>

            {storeWarning && (
              <p className="rounded-md border border-status-warning-border bg-status-warning-bg p-[var(--space-sm)] text-body-sm font-semibold text-status-warning-text">
                {storeWarning}
              </p>
            )}

            <TextInput
              name="delete-confirm"
              label={`Type "${confirmText}" to confirm`}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={confirmText}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={isDeleting}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleDelete();
              }}
            />
          </>
        )}
      </div>
    </Modal>
  );
}
