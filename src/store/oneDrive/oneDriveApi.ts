import { createAsyncThunk } from "@reduxjs/toolkit";
import api from "../../lib/api";

// ================================
// CONNECT ONEDRIVE
// ================================
interface ConnectOneDrivePayload {
  redirectUri: string;
}

export const connectOneDrive = createAsyncThunk(
  "oneDrive/connect",
  async (data: ConnectOneDrivePayload, thunkAPI) => {
    try {
      console.log("========== ONEDRIVE CONNECT REQUEST ==========");
      const response = await api.get("/onedrive/connect", {
        params: { redirectUri: data.redirectUri },
      });
      console.log("========== ONEDRIVE CONNECT SUCCESS ==========");
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error: any) {
      console.log("========== ONEDRIVE CONNECT ERROR ==========");
      const message =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        "Failed to start OneDrive connection";
      return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.status });
    }
  },
);

// ================================
// GET ONEDRIVE STATUS
// ================================
export const getOneDriveStatus = createAsyncThunk("oneDrive/status", async (_: void, thunkAPI) => {
  try {
    console.log("========== ONEDRIVE STATUS REQUEST ==========");
    const response = await api.get("/onedrive/status");
    console.log("========== ONEDRIVE STATUS SUCCESS ==========");
    console.log(JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error: any) {
    console.log("========== ONEDRIVE STATUS ERROR ==========");
    const message =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message ||
      "Failed to fetch OneDrive status";
    return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.status });
  }
});

// ================================
// DISCONNECT ONEDRIVE
// ================================
export const disconnectOneDrive = createAsyncThunk("oneDrive/disconnect", async (_: void, thunkAPI) => {
  try {
    console.log("========== ONEDRIVE DISCONNECT REQUEST ==========");
    const response = await api.delete("/onedrive/disconnect");
    console.log("========== ONEDRIVE DISCONNECT SUCCESS ==========");
    console.log(JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error: any) {
    console.log("========== ONEDRIVE DISCONNECT ERROR ==========");
    const message =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message ||
      "Failed to disconnect OneDrive";
    return thunkAPI.rejectWithValue({ message, statusCode: error?.response?.status });
  }
});
