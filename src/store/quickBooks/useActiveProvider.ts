"use client";

import { PROVIDERS } from "@/lib/accountingProvider";
import { useAppSelector } from "@/store/hooks";
import { selectActiveProviderId } from "@/store/quickBooks/quickBooksSlice";

// The accounting software of the company selected in the header — use `name`
// in any user-facing text instead of a hardcoded "QuickBooks", `id` for its icon.
export const useActiveProvider = () => {
  const id = useAppSelector(selectActiveProviderId);
  return { id, ...PROVIDERS[id] };
};
