"use client";

import { useEffect, useMemo, useState } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { getInvoiceDetails } from "@/store/invoice/invoiceApi";
import {
  createQuickBooksVendor,
  fetchQuickBooksAccounts,
  fetchQuickBooksTaxCodes,
  fetchQuickBooksVendors,
} from "@/store/quickBooks/quickBooksApi";
import type { Vendor } from "@/store/quickBooks/quickBooksSlice";
import { setSelectedVendor } from "@/store/vendor/vendorSlice";
import { CURRENCY_OPTIONS } from "@/lib/currencies";
import { showToast } from "@/lib/dialogManager";

export type VendorResolutionTab = "suggested" | "all" | "create";

// Shared brain behind both VendorResolutionContentV2 (the standalone
// /v2/invoices/[id]/vendor page) and VendorResolutionDialogV2 (the modal
// opened in place from InvoiceReviewContentV2) — same store reads, same
// thunks, same validation/fallback logic in both, so the two surfaces never
// drift apart. `onResolved` fires once a vendor is selected/created and
// dispatched to the store; the page calls router.back(), the dialog closes
// itself.
export function useVendorResolution(invoiceId: string, onResolved: () => void) {
  const dispatch = useAppDispatch();

  const selectedInvoice = useAppSelector((state) => state.invoice.selectedInvoice);
  const vendors = useAppSelector((state) => state.quickBooks.vendors);
  const vendorsLoading = useAppSelector((state) => state.quickBooks.vendorsLoading);
  const glAccounts = useAppSelector((state) => state.quickBooks.accounts);
  const glAccountsLoading = useAppSelector((state) => state.quickBooks.accountsLoading);
  const taxCodes = useAppSelector((state) => state.quickBooks.taxCodes);
  const taxCodesLoading = useAppSelector((state) => state.quickBooks.taxCodesLoading);
  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);

  useEffect(() => {
    dispatch(getInvoiceDetails(invoiceId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  useEffect(() => {
    if (!accessToken) return;
    dispatch(fetchQuickBooksVendors({ accessToken }));
    dispatch(fetchQuickBooksAccounts({ accessToken }));
    dispatch(fetchQuickBooksTaxCodes({ accessToken }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const invoiceVendor =
    selectedInvoice?.extractedData?.vendorName ||
    selectedInvoice?.file?.originalName?.replace(/\.pdf$/i, "")?.replace(/%20/g, " ") ||
    "Unknown Vendor";

  const [activeTab, setActiveTab] = useState<VendorResolutionTab>("suggested");
  const [searchText, setSearchText] = useState("");
  const [newVendorName, setNewVendorName] = useState(invoiceVendor);
  const [currency, setCurrency] = useState(CURRENCY_OPTIONS[0]);
  const [creatingVendor, setCreatingVendor] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [selectedGlAccountId, setSelectedGlAccountId] = useState("");
  const [selectedTaxCodeIdValue, setSelectedTaxCodeIdValue] = useState("");

  useEffect(() => {
    setNewVendorName(invoiceVendor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceVendor]);

  const suggestedVendors = useMemo(() => {
    const lower = invoiceVendor.toLowerCase();
    return vendors.filter((v) => v.displayName?.toLowerCase().includes(lower)).slice(0, 5);
  }, [vendors, invoiceVendor]);

  const filteredVendors = useMemo(() => {
    if (!searchText.trim()) return vendors;
    return vendors.filter((v) => v.displayName?.toLowerCase().includes(searchText.toLowerCase()));
  }, [searchText, vendors]);

  const selectedVendorObj = useMemo(
    () => vendors.find((v) => v._id === selectedVendorId) || null,
    [vendors, selectedVendorId],
  );

  const handleConfirm = () => {
    if (!selectedVendorObj) return;
    dispatch(
      setSelectedVendor({
        forInvoiceId: invoiceId,
        _id: selectedVendorObj._id,
        displayName: selectedVendorObj.displayName,
        qbVendorId: selectedVendorObj.qbVendorId,
        email: null,
        phone: null,
        address: null,
        glAccountId: selectedVendorObj.glAccountId ?? null,
        taxCodeId: selectedVendorObj.taxCodeId ?? null,
      }),
    );
    onResolved();
  };

  const handleCreateVendor = async () => {
    if (!newVendorName.trim()) {
      showToast("Please enter a vendor name.", "error");
      return;
    }
    // The backend rejects a vendor created without a default GL account
    // ("QuickBooks requires a default GL account for new vendors" — observed
    // from a real create). This screen used to label the field optional and
    // send an empty value, so the create failed at the backend after the user
    // had filled everything in. The Vendors page has always required it; these
    // two paths now agree.
    if (!selectedGlAccountId) {
      showToast("Choose a GL account — QuickBooks requires one for a new vendor.", "error");
      return;
    }
    if (creatingVendor || !accessToken) return;
    setCreatingVendor(true);
    try {
      const result = await dispatch(
        createQuickBooksVendor({
          accessToken,
          displayName: newVendorName.trim(),
          currency,
          glAccountId: selectedGlAccountId,
          taxCodeId: selectedTaxCodeIdValue,
        }),
      );

      if (createQuickBooksVendor.fulfilled.match(result)) {
        const createdPayload = result.payload as Record<string, unknown>;
        const createdVendorData =
          (createdPayload?.data as Record<string, unknown> | undefined)?.vendor ||
          (createdPayload?.data as Record<string, unknown> | undefined)?.Vendor ||
          createdPayload?.vendor ||
          createdPayload?.Vendor ||
          createdPayload?.data ||
          createdPayload ||
          {};
        const created = createdVendorData as Record<string, unknown>;

        dispatch(
          setSelectedVendor({
            forInvoiceId: invoiceId,
            _id: (created?._id as string) || "",
            displayName: (created?.displayName as string) || (created?.DisplayName as string) || newVendorName.trim(),
            qbVendorId: (created?.qbVendorId as string) || (created?.Id as string) || "",
            email:
              (created?.email as string) ||
              ((created?.PrimaryEmailAddr as { Address?: string } | undefined)?.Address ?? null),
            phone:
              (created?.phone as string) ||
              ((created?.PrimaryPhone as { FreeFormNumber?: string } | undefined)?.FreeFormNumber ?? null),
            address: (created?.address as string) || null,
            glAccountId: (created?.glAccountId as string) || selectedGlAccountId || null,
            taxCodeId: (created?.taxCodeId as string) || selectedTaxCodeIdValue || null,
          }),
        );

        // The backend already saved this vendor to the local DB as part of
        // creating it — refetch (cheap local read) so it shows up in the
        // Redux vendor list for every other screen, not just this invoice's
        // resolution, without another soft-navigation round trip.
        await dispatch(fetchQuickBooksVendors({ accessToken }));

        onResolved();
      } else {
        const payload = result.payload as { message?: string } | undefined;

        // The backend now checks its own DB and QuickBooks itself before
        // attempting a create, so a genuine duplicate-name throw here should
        // be rare — but as a safety net, refetch the vendor list and see
        // whether our vendor exists under a stable id anyway before giving up.
        const refetch = await dispatch(fetchQuickBooksVendors({ accessToken }));
        const refetchedPayload = refetch.payload;
        const freshVendors: Vendor[] = Array.isArray(refetchedPayload) ? refetchedPayload : [];
        const target = newVendorName.trim();
        const fresh =
          freshVendors.find((v) => v.displayName?.trim().toLowerCase() === target.toLowerCase()) ??
          freshVendors.find((v) => v.normalizedName?.trim().toLowerCase() === target.toLowerCase());

        if (fresh) {
          dispatch(
            setSelectedVendor({
              forInvoiceId: invoiceId,
              _id: fresh._id,
              displayName: fresh.displayName,
              qbVendorId: fresh.qbVendorId,
              email: fresh.email ?? null,
              phone: fresh.phone ?? null,
              address: fresh.address ?? null,
              glAccountId: fresh.glAccountId ?? null,
              taxCodeId: fresh.taxCodeId ?? null,
            }),
          );
          showToast(`"${fresh.displayName}" was created in QuickBooks.`, "success");
          onResolved();
          return;
        }

        showToast(payload?.message || "Failed to create vendor", "error");
      }
    } finally {
      setCreatingVendor(false);
    }
  };

  const tabs = [
    { value: "suggested" as const, label: "Suggested", count: suggestedVendors.length },
    { value: "all" as const, label: "All vendors" },
    { value: "create" as const, label: "Create new" },
  ];

  return {
    invoiceVendor,
    vendorsLoading,
    glAccounts,
    glAccountsLoading,
    taxCodes,
    taxCodesLoading,
    activeTab,
    setActiveTab,
    searchText,
    setSearchText,
    newVendorName,
    setNewVendorName,
    currency,
    setCurrency,
    creatingVendor,
    selectedVendorId,
    setSelectedVendorId,
    selectedGlAccountId,
    setSelectedGlAccountId,
    selectedTaxCodeIdValue,
    setSelectedTaxCodeIdValue,
    suggestedVendors,
    filteredVendors,
    selectedVendorObj,
    handleConfirm,
    handleCreateVendor,
    tabs,
  };
}
