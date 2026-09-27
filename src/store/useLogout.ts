"use client";

import { useRouter } from "next/navigation";

import { showToast } from "@/lib/dialogManager";

import { logoutUser } from "./auth/authApi";
import { useAppDispatch, useAppSelector } from "./hooks";

// Shared by the app shell's quick-logout and the full profile page (C19) so
// the actual logout action (dispatch + redirect) lives in exactly one place.
export function useLogout() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const refreshToken = useAppSelector((state) => state.auth.user?.data?.refreshToken);

  return async () => {
    if (!refreshToken) {
      showToast("Refresh token not found", "error");
      return;
    }
    const result = await dispatch(logoutUser({ refreshToken }));
    if (logoutUser.fulfilled.match(result)) {
      router.replace("/login");
    } else {
      const payload = result.payload;
      showToast(typeof payload === "string" ? payload : "Something went wrong", "error");
    }
  };
}
