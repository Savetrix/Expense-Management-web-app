"use client";

import { Building2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandIcon } from "@/components/icons/BrandIcon";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/v2/ui";
import { PROVIDERS, asProviderId } from "@/lib/accountingProvider";
import { showToast } from "@/lib/dialogManager";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { getPendingConnection, selectPendingConnection } from "@/store/quickBooks/quickBooksApi";

interface PendingTenant {
  tenantId: string;
  name: string | null;
}

interface PendingConnection {
  pendingConnectionId: string;
  provider: string;
  tenants: PendingTenant[];
}

const CALLBACK_ERRORS: Record<string, string> = {
  SUBSCRIPTION_REQUIRED: "An active subscription is required to connect accounting software.",
  UPGRADE_REQUIRED: "All accounting connection slots on your plan are in use. Disconnect one or upgrade to add another.",
  access_denied: "Connection was cancelled.",
  invalid_state: "That connection link has expired. Please connect again.",
};

// Handles the accounting OAuth return on whatever page it lands on (mounted
// once in AppShell): ?error=<code> becomes a toast, and
// ?pendingConnectionId=<id> (a consent that authorised several organisations
// — Xero lets the user tick more than one) opens a picker, since each
// organisation takes its own slot.
export function PendingConnectionPicker() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);

  const pendingConnectionId = searchParams.get("pendingConnectionId");
  const callbackError = searchParams.get("error");

  const [pending, setPending] = useState<PendingConnection | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  // The id the user closed. router.replace drops the query param only after a
  // transition, so without this the spinner would flash back in between.
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const active = Boolean(pendingConnectionId && accessToken) && pendingConnectionId !== dismissedId;
  // Loading = there's an id in the URL whose organisations haven't arrived yet.
  const loading = active && pending?.pendingConnectionId !== pendingConnectionId;

  useEffect(() => {
    if (!callbackError) return;
    // The URL is user-controllable: only known codes get their own text
    // (own properties only — "constructor" etc. must not resolve).
    showToast(
      Object.hasOwn(CALLBACK_ERRORS, callbackError) ? CALLBACK_ERRORS[callbackError] : "Couldn't connect your accounting software. Please try again.",
      "error",
    );
    router.replace(pathname);
  }, [callbackError, pathname, router]);

  useEffect(() => {
    if (!pendingConnectionId || !accessToken) return;
    let cancelled = false;
    dispatch(getPendingConnection({ accessToken, pendingConnectionId })).then((result) => {
      if (cancelled) return;
      if (getPendingConnection.fulfilled.match(result)) {
        setPending(result.payload?.data ?? null);
      } else {
        showToast(typeof result.payload === "string" ? result.payload : "This connection request has expired. Please connect again.", "error");
        router.replace(pathname);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pendingConnectionId, accessToken, dispatch, pathname, router]);

  const providerId = asProviderId(pending?.provider);
  const provider = PROVIDERS[providerId];

  const close = () => {
    setDismissedId(pendingConnectionId);
    setPending(null);
    router.replace(pathname);
  };

  const handleSelect = async (tenant: PendingTenant) => {
    if (!accessToken || !pending || selectingId) return;
    setSelectingId(tenant.tenantId);
    const result = await dispatch(
      selectPendingConnection({ accessToken, pendingConnectionId: pending.pendingConnectionId, tenantId: tenant.tenantId }),
    );
    setSelectingId(null);
    if (selectPendingConnection.fulfilled.match(result)) {
      // Full reload, same as a normal OAuth return: the connection lists
      // (header switcher, Integrations) all refetch on mount.
      window.location.replace(pathname);
    } else {
      showToast(typeof result.payload === "string" ? result.payload : `Could not connect this ${provider.companyNoun}.`, "error");
    }
  };

  return (
    <Modal
      open={active && (loading || Boolean(pending))}
      onClose={close}
      ariaLabel={pending ? `Choose a ${provider.name} ${provider.companyNoun}` : "Choose an organisation to connect"}
      title={
        // Neutral until the pending connection arrives — don't guess the provider.
        pending ? (
          <span className="flex items-center gap-[var(--space-sm)]">
            <BrandIcon name={providerId} size={18} />
            Choose a {provider.name} {provider.companyNoun}
          </span>
        ) : (
          "Choose an organisation to connect"
        )
      }
    >
      {loading ? (
        <div className="flex justify-center py-[var(--space-lg)]">
          <Spinner />
        </div>
      ) : (
        pending && (
          <>
            <p className="text-body-sm text-content-secondary">
              You authorised {pending.tenants.length} {provider.companyNounPlural}. Each one uses its own connection slot — pick the
              one to connect now. You can connect another later.
            </p>
            <div className="mt-[var(--space-md)] flex flex-col gap-[var(--space-sm)]">
              {pending.tenants.map((tenant) => (
                <div
                  key={tenant.tenantId}
                  className="flex items-center justify-between gap-[var(--space-md)] rounded-md border border-border px-[var(--space-md)] py-[var(--space-sm)]"
                >
                  <span className="flex min-w-0 items-center gap-[var(--space-sm)] text-body-sm font-semibold text-content-primary">
                    <Building2 size={16} strokeWidth={2} className="shrink-0 text-content-secondary" />
                    <span className="truncate">{tenant.name ?? tenant.tenantId}</span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleSelect(tenant)}
                    aria-label={`Connect ${tenant.name ?? tenant.tenantId}`}
                    loading={selectingId === tenant.tenantId}
                    disabled={Boolean(selectingId)}
                  >
                    Connect
                  </Button>
                </div>
              ))}
            </div>
          </>
        )
      )}
    </Modal>
  );
}
