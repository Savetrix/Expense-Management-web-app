"use client";

import { updateProfile } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { ChangeEvent, useMemo, useRef, useState } from "react";

import { auth, db } from "@/lib/firebase/config";
import { showToast } from "@/lib/dialogManager";
import { normalizePhotoURL } from "@/lib/textFormat";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateProfileIcon, updateUserProfile } from "@/store/auth/authApi";

// Shared by EditProfileContentV2 (the /v2/profile/edit route) and
// EditProfileDialogV2 (opened in place from ProfileContentV2) — same
// store reads, thunks, and Firebase best-effort sync either way. Only
// what happens after a successful save differs (navigate back vs. close
// the modal), so that's the one thing callers control via `onSaved`.
export function useEditProfileForm(onSaved: () => void) {
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reduxUser = useAppSelector((state) => state.auth.user);
  const apiUser = reduxUser?.data?.user;
  const accessToken: string | undefined = reduxUser?.data?.accessToken;

  const [firstName, setFirstName] = useState(apiUser?.firstName || "");
  const [lastName, setLastName] = useState(apiUser?.lastName || "");
  const [phone, setPhone] = useState(apiUser?.phone || "");
  const [email] = useState(apiUser?.email || auth.currentUser?.email || "");
  const [photoURL, setPhotoURL] = useState(normalizePhotoURL(apiUser?.icon || auth.currentUser?.photoURL || ""));
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);

  const initials = useMemo(
    () => (firstName.trim() || email.trim() || "U").charAt(0).toUpperCase(),
    [firstName, email],
  );
  const hasPhoto = !!normalizePhotoURL(photoURL) && !imageLoadFailed;
  const canSave = !isSaving && !isUploadingPhoto && firstName.trim().length > 0;

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const userId = apiUser?._id;
    if (!userId || !accessToken) {
      showToast("User ID or access token not found", "error");
      return;
    }

    setIsUploadingPhoto(true);
    try {
      const result = await dispatch(updateProfileIcon({ file, userId, accessToken }));
      if (!updateProfileIcon.fulfilled.match(result)) {
        const payload = result.payload;
        showToast(typeof payload === "string" ? payload : "Could not upload profile photo.", "error");
        return;
      }
      const payload = result.payload as { data?: { icon?: string; user?: { icon?: string } }; icon?: string };
      const uploadedImage = payload?.data?.icon || payload?.icon || payload?.data?.user?.icon;
      if (!uploadedImage) {
        showToast("Image URL not returned from API", "error");
        return;
      }
      const finalImage = normalizePhotoURL(uploadedImage);
      setPhotoURL(finalImage);
      setImageLoadFailed(false);
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { photoURL: finalImage }).catch(() => {});
      }
      showToast("Profile photo updated successfully.", "success");
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = () => setPhotoURL("");

  const handleSaveProfile = async () => {
    const userId = apiUser?._id;
    if (!userId || !accessToken) {
      showToast("User ID or access token not found", "error");
      return;
    }

    const trimmedFirstName = firstName.trim();
    if (!trimmedFirstName) {
      showToast("First name is required", "error");
      return;
    }
    const trimmedLastName = lastName.trim();
    const trimmedPhone = phone.trim();

    setIsSaving(true);
    try {
      const result = await dispatch(
        updateUserProfile({
          userId,
          accessToken,
          firstName: trimmedFirstName,
          lastName: trimmedLastName,
          phone: trimmedPhone,
        }),
      );

      if (!updateUserProfile.fulfilled.match(result)) {
        const payload = result.payload;
        showToast(typeof payload === "string" ? payload : "Could not update profile.", "error");
        return;
      }

      // Best-effort only — Firebase Auth/Firestore aren't the source of
      // truth for this data (the backend call above is), so a failure here
      // shouldn't mask the real save that already succeeded.
      const finalPhotoURL = normalizePhotoURL(photoURL);
      const displayName = `${trimmedFirstName} ${trimmedLastName}`.trim();
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName, photoURL: finalPhotoURL || null }).catch(() => {});
      }
      if (auth.currentUser?.uid) {
        await setDoc(
          doc(db, "users", auth.currentUser.uid),
          { uid: auth.currentUser.uid, email, displayName, photoURL: finalPhotoURL, updatedAt: serverTimestamp() },
          { merge: true },
        ).catch(() => {});
      }

      showToast("Your profile has been updated.", "success");
      onSaved();
    } finally {
      setIsSaving(false);
    }
  };

  return {
    fileInputRef,
    firstName,
    setFirstName,
    lastName,
    setLastName,
    phone,
    setPhone,
    email,
    photoURL,
    isSaving,
    isUploadingPhoto,
    imageLoadFailed,
    setImageLoadFailed,
    initials,
    hasPhoto,
    canSave,
    handleFileChange,
    handleRemovePhoto,
    handleSaveProfile,
  };
}
