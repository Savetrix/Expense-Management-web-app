// Expense claims and mileage have no API yet. Claims, journeys, vehicles and
// rates live in local React state and start empty; receipts come from the
// real pending invoices and drivers/claimants from the real team members.
// Replace the local state with thunks once the backend endpoints exist (see
// the "(BE)" buttons).

export type ReceiptSource = "Upload" | "Email" | "WhatsApp";
export type ClaimStatus = "awaiting_review" | "awaiting_reimbursement" | "paid";
export type FuelType = "Petrol" | "Diesel" | "Electric" | "Hybrid";
export type VehicleOwnership = "company" | "personal";
export type JourneyStatus = "Draft" | "Published";

export const FUEL_TYPES: FuelType[] = ["Petrol", "Diesel", "Electric", "Hybrid"];

export interface ClaimReceipt {
  /** The scanned invoice's _id. */
  id: string;
  vendor: string;
  date: string; // YYYY-MM-DD, "" when the scan has no date
  glAccount?: string;
  tax: number;
  amount: number; // gross, incl. tax
  currency?: string;
  source?: ReceiptSource;
  note?: string;
}

export interface ExpenseClaim {
  id: string;
  claimant: string;
  month: string; // YYYY-MM
  status: ClaimStatus;
  receipts: ClaimReceipt[];
  createdAt: string;
  publishedAt?: string;
  approvedAt?: string;
  paidAt?: string;
}

export interface Contact {
  id: string;
  name: string;
}

export interface Driver {
  id: string;
  name: string;
}

export interface Vehicle {
  id: string;
  name: string;
  fuelType: FuelType;
  ownership: VehicleOwnership;
}

export interface Journey {
  id: string;
  date: string;
  driverId: string;
  /** Kept on the journey so it still reads correctly if the person leaves the team. */
  driverName: string;
  vehicleId: string;
  start: string;
  end: string;
  returnTrip: boolean;
  km: number;
  rate: number;
  passenger: boolean;
  passengerRate: number;
  purpose: string;
  status: JourneyStatus;
}

/** null = not set yet; there is no default rate. */
export interface MileageRates {
  perKm: number | null;
  passengerPerKm: number | null;
}
