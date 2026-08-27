// Ported from Scantrix_v2 src/redux/store.ts (branch frontend-ui-v2).
// AsyncStorage -> redux-persist's web storage engine, guarded for SSR (see
// ./persistStorage.ts). persistStore(store) itself is NOT called here — it
// only runs client-side, inside src/app/providers.tsx — so this module is
// safe to import from anywhere, including the server.
import { configureStore, combineReducers } from "@reduxjs/toolkit";
import {
  persistReducer,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from "redux-persist";

import persistStorage from "./persistStorage";
import { setQbConnectionId } from "../lib/qbConnection";

import authReducer from "./auth/authSlice";
import invoiceReducer from "./invoice/invoiceSlice";
import vendorReducer from "./vendor/vendorSlice";
import quickBooksReducer from "./quickBooks/quickBooksSlice";
import subscriptionReducer from "./subscription/subscriptionSlice";
import chatReducer from "./chat/chatSlice";
import inboundEmailReducer from "./inboundEmail/inboundEmailSlice";

// Only persist the QB fields we need across restarts.
// auth/invoice/vendor are untouched — auth already uses its own
// storage (saveUser) so no change needed there.
const quickBooksPersistConfig = {
  key: "quickBooks",
  storage: persistStorage,
  whitelist: ["connected", "realmId", "qbConnectionId", "hasExplicitSelection"],
};

const rootReducer = combineReducers({
  auth: authReducer,           // unchanged — uses saveUser() directly
  invoice: invoiceReducer,     // unchanged
  vendor: vendorReducer,       // unchanged
  quickBooks: persistReducer(quickBooksPersistConfig, quickBooksReducer),
  subscription: subscriptionReducer,
  chat: chatReducer, // unchanged — deliberately not persisted, see chatSlice.ts
  // Not persisted either: a stale cached receiving address would have an
  // accountant forwarding invoices to an address that no longer resolves.
  inboundEmail: inboundEmailReducer,
});

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
});

// Push qbConnectionId into lib/qbConnection.ts on every state change, so
// lib/api.ts's interceptor can read it without importing this module (see
// that file's comment for why importing the store back would be circular).
store.subscribe(() => {
  setQbConnectionId(store.getState().quickBooks.qbConnectionId || null);
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
