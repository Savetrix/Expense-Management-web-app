// Ported from Scantrix_v2 src/utils/storage.ts (branch frontend-ui-v2).
// AsyncStorage -> localStorage. Every browser storage call is guarded
// individually since Next.js App Router can execute this module server-side.

const getItem = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
};

const setItem = (key: string, value: string): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
};

const removeItem = (key: string): void => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
};


// ==============================
// SAVE ACCESS TOKEN
// ==============================

export const saveAccessToken = async (
  token: string
) => {
  try {
    setItem(
      "accessToken",
      token
    );
  } catch (error) {
    console.log(
      "Error saving access token:",
      error
    );
  }
};


// ==============================
// SAVE REFRESH TOKEN
// ==============================

export const saveRefreshToken = async (
  token: string
) => {
  try {
    setItem(
      "refreshToken",
      token
    );
  } catch (error) {
    console.log(
      "Error saving refresh token:",
      error
    );
  }
};


// ==============================
// SAVE USER
// ==============================

export const saveUser = async (
  user: any
) => {
  try {
    setItem(
      "user",
      JSON.stringify(user)
    );
  } catch (error) {
    console.log(
      "Error saving user:",
      error
    );
  }
};


// ==============================
// GET ACCESS TOKEN
// ==============================

export const getAccessToken = async () => {
  try {
    return getItem(
      "accessToken"
    );
  } catch (error) {
    console.log(
      "Error getting access token:",
      error
    );

    return null;
  }
};


// ==============================
// GET REFRESH TOKEN
// ==============================

export const getRefreshToken = async () => {
  try {
    return getItem(
      "refreshToken"
    );
  } catch (error) {
    console.log(
      "Error getting refresh token:",
      error
    );

    return null;
  }
};


// ==============================
// GET USER
// ==============================

export const getUser = async () => {
  try {
    const user = getItem(
      "user"
    );

    return user ? JSON.parse(user) : null;
  } catch (error) {
    console.log(
      "Error getting user:",
      error
    );

    return null;
  }
};


// ==============================
// CLEAR STORAGE
// ==============================

export const clearStorage = async () => {
  try {
    ["accessToken", "refreshToken", "user"].forEach(removeItem);
  } catch (error) {
    console.log(
      "Error clearing storage:",
      error
    );
  }
};


// ==============================
// PENDING INVITE TOKEN
// (CASE A: invite link tapped while logged out — saved here,
// then consumed right after the user logs in)
// ==============================

const PENDING_INVITE_KEY = "pendingInviteToken";

export const savePendingInviteToken = async (
  token: string
) => {
  try {
    setItem(
      PENDING_INVITE_KEY,
      token
    );
  } catch (error) {
    console.log(
      "Error saving pending invite token:",
      error
    );
  }
};

export const getPendingInviteToken = async () => {
  try {
    return getItem(
      PENDING_INVITE_KEY
    );
  } catch (error) {
    console.log(
      "Error getting pending invite token:",
      error
    );

    return null;
  }
};

export const clearPendingInviteToken = async () => {
  try {
    removeItem(
      PENDING_INVITE_KEY
    );
  } catch (error) {
    console.log(
      "Error clearing pending invite token:",
      error
    );
  }
};

// ==============================
// GOOGLE DRIVE CONNECTED-AT (client-side approximation — the backend's
// /google-drive/status response only ever returns {connected}, no
// timestamp, so this is stamped locally the first time a connection is
// observed. Accurate for connections made going forward; for an account
// that was already connected before this existed, it just starts counting
// from whenever it's first checked, which is the best available proxy
// without backend support.)
// ==============================

const DRIVE_CONNECTED_AT_KEY = "driveConnectedAt";

export const getDriveConnectedAt = (): string | null => {
  return getItem(DRIVE_CONNECTED_AT_KEY);
};

export const setDriveConnectedAt = (isoDate: string): void => {
  setItem(DRIVE_CONNECTED_AT_KEY, isoDate);
};

export const clearDriveConnectedAt = (): void => {
  removeItem(DRIVE_CONNECTED_AT_KEY);
};

// Same client-side approximation for OneDrive (/onedrive/status also returns
// only {connected, email}).
const ONEDRIVE_CONNECTED_AT_KEY = "oneDriveConnectedAt";

export const getOneDriveConnectedAt = (): string | null => {
  return getItem(ONEDRIVE_CONNECTED_AT_KEY);
};

export const setOneDriveConnectedAt = (isoDate: string): void => {
  setItem(ONEDRIVE_CONNECTED_AT_KEY, isoDate);
};

export const clearOneDriveConnectedAt = (): void => {
  removeItem(ONEDRIVE_CONNECTED_AT_KEY);
};

// ==============================
// SIDEBAR PINNED (UI preference, not session data — kept synchronous
// since AppShell reads it once on mount to set local component state,
// unlike the async token/user helpers above which mirror AsyncStorage's
// Promise-based API from the mobile port)
// ==============================

const SIDEBAR_PINNED_KEY = "sidebarPinned";

export const getSidebarPinned = (): boolean => {
  return getItem(SIDEBAR_PINNED_KEY) === "true";
};

export const setSidebarPinned = (pinned: boolean): void => {
  setItem(SIDEBAR_PINNED_KEY, pinned ? "true" : "false");
};
