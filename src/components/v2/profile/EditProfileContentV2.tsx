"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useEditProfileForm } from "./useEditProfileForm";

const FIELD_LABEL_CLASS = "text-body-sm font-semibold text-content-primary";
const FIELD_INPUT_CLASS =
  "mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-page px-[var(--space-md)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60";

export function EditProfileContentV2() {
  const router = useRouter();
  const {
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
    setImageLoadFailed,
    initials,
    hasPhoto,
    canSave,
    handleFileChange,
    handleRemovePhoto,
    handleSaveProfile,
  } = useEditProfileForm(() => router.back());

  return (
    <div className="w-full max-w-2xl p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <p className="mb-[var(--space-xs)] flex items-center gap-[var(--space-xs)] text-tiny font-bold uppercase tracking-[0.08em] text-accent-text-on-bg">
        <Link href="/v2/profile" className="hover:underline">
          Account
        </Link>
        <ChevronRight size={11} strokeWidth={2.5} className="text-content-muted" />
        Edit Profile
      </p>
      <h1 className="text-h1 font-bold text-content-primary">Edit Profile</h1>

      <div className="mt-[var(--space-lg)] rounded-lg border border-border bg-surface p-[var(--space-lg)] shadow-sm">
        <h2 className="mb-[var(--space-md)] text-h3 font-bold text-content-primary">Profile Photo</h2>
        <div className="flex flex-col items-center">
          <div className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-accent-bg">
            {hasPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoURL}
                alt="Profile"
                className="h-full w-full object-cover"
                onError={() => setImageLoadFailed(true)}
                onLoad={() => setImageLoadFailed(false)}
              />
            ) : (
              <span className="text-4xl font-bold text-accent-text-on-bg">{initials}</span>
            )}
          </div>

          <div className="mt-[var(--space-md)] w-full">
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingPhoto || isSaving}
              loading={isUploadingPhoto}
              className="w-full"
            >
              {hasPhoto ? "Change Photo" : "Upload Photo"}
            </Button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

            {hasPhoto && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                disabled={isUploadingPhoto || isSaving}
                className="mt-[var(--space-sm)] h-11 w-full rounded-md bg-status-danger-bg font-bold text-status-danger-text disabled:cursor-not-allowed disabled:opacity-60"
              >
                Remove Photo
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-[var(--space-md)] rounded-lg border border-border bg-surface p-[var(--space-lg)] shadow-sm">
        <h2 className="mb-[var(--space-md)] text-h3 font-bold text-content-primary">Basic Info</h2>

        <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-2">
          <div>
            <label className={FIELD_LABEL_CLASS}>First name</label>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              disabled={isSaving || isUploadingPhoto}
              className={FIELD_INPUT_CLASS}
            />
          </div>
          <div>
            <label className={FIELD_LABEL_CLASS}>Last name</label>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              disabled={isSaving || isUploadingPhoto}
              className={FIELD_INPUT_CLASS}
            />
          </div>
        </div>

        <label className={`mt-[var(--space-md)] block ${FIELD_LABEL_CLASS}`}>Phone</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Enter your phone number"
          type="tel"
          disabled={isSaving || isUploadingPhoto}
          className={FIELD_INPUT_CLASS}
        />

        <label className={`mt-[var(--space-md)] block ${FIELD_LABEL_CLASS}`}>Email</label>
        <input
          value={email}
          disabled
          className="mt-[var(--space-xs)] h-[50px] w-full rounded-md border border-border bg-surface-alt px-[var(--space-md)] text-body text-content-secondary"
        />
      </div>

      <Button type="button" onClick={handleSaveProfile} disabled={!canSave} loading={isSaving} className="mt-[var(--space-lg)] w-full">
        {isSaving ? "Saving…" : "Save Changes"}
      </Button>
    </div>
  );
}
