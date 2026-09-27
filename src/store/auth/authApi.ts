import { createAsyncThunk } from "@reduxjs/toolkit";
import { PURGE } from "redux-persist";

import api from "../../lib/api";
import { RootState } from "..";

import {
  saveAccessToken,
  saveRefreshToken,
  saveUser,
  clearStorage,
} from "../../lib/storage";

// Dispatches redux-persist's PURGE action, which every persistReducer-wrapped
// slice (currently just quickBooks — see store/index.ts) intercepts to wipe
// its own localStorage entry. Called on every logout and fresh login so a
// previous session's persisted qbConnectionId/connected/realmId can never
// sit in storage waiting to be rehydrated into a different user's session.
const purgePersistedState = (dispatch: (action: unknown) => void) => {
  const results: Promise<unknown>[] = [];
  dispatch({ type: PURGE, result: (r: Promise<unknown>) => results.push(r) });
  return Promise.all(results);
};



// ================================
// REGISTER USER
// ================================

interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone: string;
  userType: string;
}

export const registerUser = createAsyncThunk(
  "auth/registerUser",

  async (
    userData: RegisterPayload,
    thunkAPI
  ) => {
    try {
      console.log(
        "========== API REQUEST =========="
      );

      console.log(
        "POST /auth/register"
      );

      console.log("Request Body:");

      console.log(
        JSON.stringify(
          userData,
          null,
          2
        )
      );

      const response = await api.post(
        "/auth/register",
        userData
      );

      console.log(
        "========== API SUCCESS RESPONSE =========="
      );

      console.log(
        JSON.stringify(
          response.data,
          null,
          2
        )
      );

      return response.data;
    } catch (error: any) {
      console.log(
        "========== API ERROR =========="
      );

      console.log(error);

      const errorMessage =
        error?.response?.data
          ?.message ||
        error?.response?.data
          ?.error ||
        error?.message ||
        "Something went wrong";

      return thunkAPI.rejectWithValue(
        errorMessage
      );
    }
  }
);



// ================================
// VERIFY REGISTER OTP
// ================================

interface VerifyRegisterOtpPayload {
  email: string;
  otp: string;
}

export const verifyRegisterOtp = createAsyncThunk(
  "auth/verifyRegisterOtp",

  async (
    data: VerifyRegisterOtpPayload,
    thunkAPI
  ) => {
    try {
      console.log(
        "========== VERIFY REGISTER OTP API REQUEST =========="
      );

      console.log(
        "POST /auth/verify-register"
      );

      console.log(
        JSON.stringify(data, null, 2)
      );

      const response = await api.post(
        "/auth/verify-register",
        data
      );

      console.log(
        "========== VERIFY REGISTER OTP API SUCCESS =========="
      );

      console.log(
        JSON.stringify(response.data, null, 2)
      );

      // Defensively reset any QB session data left over from a previous
      // user on this browser before this session saves its own tokens or
      // any QB-scoped fetch can fire. Same reasoning as loginUser —
      // verifyRegisterOtp is the register-flow's own session-establishment
      // point (see ASSUMPTIONS.md C13), so it needs the same purge.
      await purgePersistedState(thunkAPI.dispatch);

      // ==============================
      // EXTRACT DATA
      // ==============================

      const accessToken =
        response.data?.data?.accessToken;

      const refreshToken =
        response.data?.data?.refreshToken;

      // Save FULL response — same pattern as loginUser,
      // because app UI uses: user.data.user

      const user = response.data;

      // ==============================
      // SAVE TOKENS + USER
      // ==============================

      if (accessToken) {
        await saveAccessToken(accessToken);
      }

      if (refreshToken) {
        await saveRefreshToken(refreshToken);
      }

      if (user) {
        await saveUser(user);
      }

      return response.data;
    } catch (error: any) {
      console.log(
        "========== VERIFY REGISTER OTP API ERROR =========="
      );

      console.log(error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "OTP verification failed";

      return thunkAPI.rejectWithValue(errorMessage);
    }
  }
);



// ================================
// RESEND REGISTER OTP
// ================================

interface ResendRegisterOtpPayload {
  email: string;
}

export const resendRegisterOtp = createAsyncThunk(
  "auth/resendRegisterOtp",

  async (
    data: ResendRegisterOtpPayload,
    thunkAPI
  ) => {
    try {
      console.log(
        "========== RESEND REGISTER OTP API REQUEST =========="
      );

      console.log(
        JSON.stringify(data, null, 2)
      );

      const response = await api.post(
        "/auth/resend-register-otp",
        data
      );

      console.log(
        "========== RESEND REGISTER OTP API SUCCESS =========="
      );

      console.log(
        JSON.stringify(response.data, null, 2)
      );

      return response.data;
    } catch (error: any) {
      console.log(
        "========== RESEND REGISTER OTP API ERROR =========="
      );

      console.log(error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Could not resend OTP";

      return thunkAPI.rejectWithValue(errorMessage);
    }
  }
);



// ================================
// LOGIN USER
// ================================

interface LoginPayload {
  email: string;
  password: string;
}

export const loginUser = createAsyncThunk(
  "auth/loginUser",

  async (
    userData: LoginPayload,
    thunkAPI
  ) => {
    try {
      console.log(
        "========== LOGIN API REQUEST =========="
      );

      console.log(
        "POST /auth/login"
      );

      console.log("Request Body:");

      console.log(
        JSON.stringify(
          userData,
          null,
          2
        )
      );

      const response = await api.post(
        "/auth/login",
        userData
      );

      console.log(
        "========== LOGIN API SUCCESS =========="
      );

      console.log(
        JSON.stringify(
          response.data,
          null,
          2
        )
      );

      // Defensively reset any QB session data left over from a previous
      // user on this browser before this session saves its own tokens or
      // any QB-scoped fetch can fire.
      await purgePersistedState(thunkAPI.dispatch);

      // ==============================
      // EXTRACT DATA
      // ==============================

      const accessToken =
        response.data?.data
          ?.accessToken;

      const refreshToken =
        response.data?.data
          ?.refreshToken;

      // IMPORTANT:
      // save FULL response
      // because app UI uses:
      // user.data.user

      const user =
        response.data;

      // ==============================
      // SAVE TOKENS + USER
      // ==============================

      if (accessToken) {
        await saveAccessToken(
          accessToken
        );
      }

      if (refreshToken) {
        await saveRefreshToken(
          refreshToken
        );
      }

      if (user) {
        await saveUser(user);
      }

      return response.data;
    } catch (error: any) {
      console.log(
        "========== LOGIN API ERROR =========="
      );

      console.log(error);

      const errorMessage =
        error?.response?.data
          ?.message ||
        error?.response?.data
          ?.error ||
        error?.message ||
        "Login failed";

      return thunkAPI.rejectWithValue(
        errorMessage
      );
    }
  }
);



// ================================
// LOGOUT USER
// ================================

interface LogoutPayload {
  refreshToken: string;
}

export const logoutUser = createAsyncThunk(
  "auth/logoutUser",

  async (
    data: LogoutPayload,
    thunkAPI
  ) => {
    try {
      console.log(
        "========== LOGOUT API REQUEST =========="
      );

      const response = await api.post(
        "/auth/logout",
        data
      );

      await clearStorage();
      await purgePersistedState(thunkAPI.dispatch);

      return response.data;
    } catch (error: any) {
      await clearStorage();
      await purgePersistedState(thunkAPI.dispatch);

      const errorMessage =
        error?.response?.data
          ?.message ||
        error?.message ||
        "Logout failed";

      return thunkAPI.rejectWithValue(
        errorMessage
      );
    }
  }
);



// ================================
// FORGOT PASSWORD
// ================================
// Backend contract (src/routes/auth.routes.js + auth.controller.js):
// POST /auth/forgot-password { email } sends a 6-digit OTP (10-min expiry,
// 60s resend cooldown) to that email if an active account exists for it —
// including Google/Apple-only accounts with no password yet, since
// resetPassword doubles as a way to add a password to an OAuth account.

interface ForgotPasswordPayload {
  email: string;
}

export const forgotPassword = createAsyncThunk(
  "auth/forgotPassword",

  async (
    data: ForgotPasswordPayload,
    thunkAPI
  ) => {
    try {
      console.log(
        "========== FORGOT PASSWORD API REQUEST =========="
      );

      console.log(
        "POST /auth/forgot-password"
      );

      console.log(
        JSON.stringify(data, null, 2)
      );

      const response = await api.post(
        "/auth/forgot-password",
        data
      );

      console.log(
        "========== FORGOT PASSWORD API SUCCESS =========="
      );

      console.log(
        JSON.stringify(response.data, null, 2)
      );

      return response.data;
    } catch (error: any) {
      console.log(
        "========== FORGOT PASSWORD API ERROR =========="
      );

      console.log(error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Could not send reset code";

      return thunkAPI.rejectWithValue(errorMessage);
    }
  }
);



// ================================
// RESET PASSWORD
// ================================
// Backend contract: POST /auth/reset-password { email, otp, newPassword }
// verifies the OTP and sets the new password in one step — no separate
// verify-then-reset round trip. On success the backend logs the user in
// immediately, returning the same { user, accessToken, refreshToken } shape
// as /auth/login, so this saves tokens/user the same way loginUser does.

interface ResetPasswordPayload {
  email: string;
  otp: string;
  newPassword: string;
}

export const resetPassword = createAsyncThunk(
  "auth/resetPassword",

  async (
    data: ResetPasswordPayload,
    thunkAPI
  ) => {
    try {
      console.log(
        "========== RESET PASSWORD API REQUEST =========="
      );

      console.log(
        "POST /auth/reset-password"
      );

      const response = await api.post(
        "/auth/reset-password",
        data
      );

      console.log(
        "========== RESET PASSWORD API SUCCESS =========="
      );

      console.log(
        JSON.stringify(response.data, null, 2)
      );

      // Defensively reset any QB session data left over from a previous
      // user on this browser before this session saves its own tokens or
      // any QB-scoped fetch can fire. Same reasoning as loginUser.
      await purgePersistedState(thunkAPI.dispatch);

      const accessToken = response.data?.data?.accessToken;
      const refreshToken = response.data?.data?.refreshToken;

      // Save FULL response — same pattern as loginUser, because app UI
      // uses: user.data.user
      const user = response.data;

      if (accessToken) {
        await saveAccessToken(accessToken);
      }

      if (refreshToken) {
        await saveRefreshToken(refreshToken);
      }

      if (user) {
        await saveUser(user);
      }

      return response.data;
    } catch (error: any) {
      console.log(
        "========== RESET PASSWORD API ERROR =========="
      );

      console.log(error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Could not reset password";

      return thunkAPI.rejectWithValue(errorMessage);
    }
  }
);



// ================================
// PICK PROFILE IMAGE
// ================================
// TODO(web-port): expo-image-picker has no web equivalent and is not
// installed in this project. Profile image selection on web should be
// implemented in the UI layer with a browser file input
// (<input type="file" accept="image/*">) and its FileList/Blob passed
// directly to updateProfileIcon below — this function is a placeholder
// until that UI is built.

export const pickProfileImage = async (): Promise<string | null> => {
  throw new Error(
    "pickProfileImage is not implemented for web. Use a browser file input in the UI layer instead."
  );
};



// ================================
// UPDATE PROFILE ICON API
// ================================

interface UpdateProfileIconPayload {
  file: File;
  userId: string;
  accessToken: string;
}

export const updateProfileIcon =
  createAsyncThunk(
    "auth/updateProfileIcon",

    async (
      data: UpdateProfileIconPayload,
      thunkAPI
    ) => {
      try {
        // NOTE(web-port fix): same class of bug as invoiceApi.ts's
        // scanInvoice — the version inherited from the logic-layer port
        // appended a React-Native-only {uri, name, type} object to
        // FormData (browsers need a real File/Blob) and manually set a
        // boundary-less multipart Content-Type header (the browser must
        // generate that itself). Fixed to take a browser File directly.
        const formData =
          new FormData();

        formData.append("icon", data.file, data.file.name);

        const response =
          await api.post(
            `/users/${data.userId}/icon`,
            formData,
            {
              headers: {
                Authorization: `Bearer ${data.accessToken}`,
              },
            }
          );

        return response.data;
      } catch (error: any) {
        const errorMessage =
          error?.response
            ?.data
            ?.message ||
          error?.message ||
          "Profile icon update failed";

        return thunkAPI.rejectWithValue(
          errorMessage
        );
      }
    }
  );



// ================================
// UPDATE USER PROFILE
// ================================
// NOTE(bug fix): EditProfileContent used to only call Firebase's
// updateProfile()/Firestore setDoc() for the name field — it never touched
// the real backend user record, so a saved name never showed up anywhere
// else in the app (sidebar, profile page) since those all read
// state.auth.user.data.user, which this fixes by actually calling it.
// Backend contract: PATCH /users/:id, allowedFields =
// ["firstName", "lastName", "phone", "icon", "onBoardingCompleted"] (see
// Scantrix_API's user.controller.js/updateUser) — only the fields present
// in the body get updated, so partial updates (e.g. phone only) are fine.

interface UpdateUserProfilePayload {
  userId: string;
  accessToken: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export const updateUserProfile = createAsyncThunk(
  "auth/updateUserProfile",

  async (
    data: UpdateUserProfilePayload,
    thunkAPI
  ) => {
    try {
      const { userId, accessToken, ...fields } = data;

      console.log(
        "========== UPDATE USER PROFILE API REQUEST =========="
      );

      console.log(
        JSON.stringify(fields, null, 2)
      );

      const response = await api.patch(
        `/users/${userId}`,
        fields,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      console.log(
        "========== UPDATE USER PROFILE API SUCCESS =========="
      );

      console.log(
        JSON.stringify(response.data, null, 2)
      );

      // Keep localStorage in sync — AuthGate's restoreUser() reads straight
      // from there on every fresh page load, not from this thunk's return
      // value, so without this a refresh would revert the name/phone back
      // to whatever was saved at login.
      const state = thunkAPI.getState() as RootState;
      const currentUser = state.auth.user;
      const updatedFields = response.data?.data;
      if (currentUser?.data?.user && updatedFields) {
        await saveUser({
          ...currentUser,
          data: {
            ...currentUser.data,
            user: { ...currentUser.data.user, ...updatedFields },
          },
        });
      }

      return response.data;
    } catch (error: any) {
      console.log(
        "========== UPDATE USER PROFILE API ERROR =========="
      );

      console.log(error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        "Could not update profile";

      return thunkAPI.rejectWithValue(errorMessage);
    }
  }
);



  // ================================
// GOOGLE LOGIN
// ================================

interface GoogleLoginPayload {
  idToken: string; // Google ID token from Google Identity Services JS SDK
}

export const googleLogin = createAsyncThunk(
  "auth/googleLogin",

  async (
    data: GoogleLoginPayload,
    thunkAPI
  ) => {
    try {
      console.log(
        "========== GOOGLE LOGIN API REQUEST =========="
      );

      console.log(
        "POST /auth/google-login"
      );

      console.log(
        JSON.stringify(data, null, 2)
      );

      const response = await api.post("/auth/google", data);

      console.log(
        "========== GOOGLE LOGIN API SUCCESS =========="
      );

      console.log(
        JSON.stringify(response.data, null, 2)
      );

      // Defensively reset any QB session data left over from a previous
      // user on this browser before this session saves its own tokens or
      // any QB-scoped fetch can fire.
      await purgePersistedState(thunkAPI.dispatch);

      // ==============================
      // EXTRACT DATA
      // ==============================

      const accessToken =
        response.data?.data?.accessToken;

      const refreshToken =
        response.data?.data?.refreshToken;

      // Save FULL response — same pattern as loginUser
      const user = response.data;

      // ==============================
      // SAVE TOKENS + USER
      // ==============================

      if (accessToken) {
        await saveAccessToken(accessToken);
      }

      if (refreshToken) {
        await saveRefreshToken(refreshToken);
      }

      if (user) {
        await saveUser(user);
      }

      return response.data;
    } catch (error: any) {
      console.log(
        "========== GOOGLE LOGIN API ERROR =========="
      );

      console.log(error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Google login failed";

      return thunkAPI.rejectWithValue(errorMessage);
    }
  }
);


interface AppleLoginPayload {
  identityToken: string;
  firstName: string;
  lastName: string;
  email: string;
}


export const appleLogin = createAsyncThunk(
  "auth/appleLogin",

  async (
    data: AppleLoginPayload,
    thunkAPI
  ) => {
    try {
      console.log(
        "========== APPLE LOGIN API REQUEST =========="
      );

      console.log(
        JSON.stringify(data, null, 2)
      );

      const response = await api.post(
        "/auth/apple",
        data
      );

      console.log(
        "========== APPLE LOGIN API SUCCESS =========="
      );

      console.log(
        JSON.stringify(response.data, null, 2)
      );

      // Defensively reset any QB session data left over from a previous
      // user on this browser before this session saves its own tokens or
      // any QB-scoped fetch can fire.
      await purgePersistedState(thunkAPI.dispatch);

      const accessToken =
        response.data?.data?.accessToken;

      const refreshToken =
        response.data?.data?.refreshToken;

      const user = response.data;

      if (accessToken) {
        await saveAccessToken(accessToken);
      }

      if (refreshToken) {
        await saveRefreshToken(refreshToken);
      }

      if (user) {
        await saveUser(user);
      }

      return response.data;
    } catch (error: any) {
      console.log(
        "========== APPLE LOGIN API ERROR =========="
      );

      console.log(error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Apple login failed";

      return thunkAPI.rejectWithValue(
        errorMessage
      );
    }
  }
);


// ================================
// MICROSOFT LOGIN
// ================================
// POST /auth/microsoft with { idToken: <MSAL ID token (JWT)> }, mirroring
// googleLogin/appleLogin. Responds with the same { data: { user,
// accessToken, refreshToken } } shape as /auth/google. MicrosoftSignInButton
// stays in its "Coming Soon" state until NEXT_PUBLIC_MICROSOFT_CLIENT_ID is
// set in this environment.

interface MicrosoftLoginPayload {
  idToken: string; // Microsoft/Azure AD ID token from @azure/msal-browser's loginPopup()
}

export const microsoftLogin = createAsyncThunk(
  "auth/microsoftLogin",

  async (
    data: MicrosoftLoginPayload,
    thunkAPI
  ) => {
    try {
      console.log(
        "========== MICROSOFT LOGIN API REQUEST =========="
      );

      console.log(
        "POST /auth/microsoft"
      );

      console.log(
        JSON.stringify(data, null, 2)
      );

      const response = await api.post("/auth/microsoft", data);

      console.log(
        "========== MICROSOFT LOGIN API SUCCESS =========="
      );

      console.log(
        JSON.stringify(response.data, null, 2)
      );

      // Defensively reset any QB session data left over from a previous
      // user on this browser before this session saves its own tokens or
      // any QB-scoped fetch can fire.
      await purgePersistedState(thunkAPI.dispatch);

      const accessToken =
        response.data?.data?.accessToken;

      const refreshToken =
        response.data?.data?.refreshToken;

      // Save FULL response — same pattern as loginUser/googleLogin
      const user = response.data;

      if (accessToken) {
        await saveAccessToken(accessToken);
      }

      if (refreshToken) {
        await saveRefreshToken(refreshToken);
      }

      if (user) {
        await saveUser(user);
      }

      return response.data;
    } catch (error: any) {
      console.log(
        "========== MICROSOFT LOGIN API ERROR =========="
      );

      console.log(error);

      const errorMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Microsoft login failed";

      return thunkAPI.rejectWithValue(errorMessage);
    }
  }
);
