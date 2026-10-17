// SAMPLE DATA ONLY — expense claims and mileage have no API yet. Everything on
// /expense-claims runs on these records held in local React state; replace
// with real thunks once the backend endpoints exist (see the "(BE)" buttons).

export type ReceiptSource = "Upload" | "Email" | "WhatsApp";
export type ClaimStatus = "awaiting_review" | "awaiting_reimbursement" | "paid";
export type FuelType = "Petrol" | "Diesel" | "Electric" | "Hybrid";
export type VehicleOwnership = "company" | "personal";
export type JourneyStatus = "Draft" | "Published";

export interface ClaimReceipt {
  id: string;
  vendor: string;
  date: string; // YYYY-MM-DD
  glAccount: string;
  tax: number;
  amount: number; // gross, incl. tax
  source: ReceiptSource;
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

export interface MileageRates {
  perKm: number;
  passengerPerKm: number;
}

export const MOCK_CURRENCY = "CAD";

export const MOCK_CONTACTS: Contact[] = [
  { id: "c-sam", name: "Sam Patel" },
  { id: "c-maria", name: "Maria Gonzalez" },
  { id: "c-jordan", name: "Jordan Lee" },
  { id: "c-aisha", name: "Aisha Khan" },
];

export const MOCK_CLAIMS: ExpenseClaim[] = [
  {
    id: "cl-1",
    claimant: "Sam Patel",
    month: "2026-09",
    status: "awaiting_review",
    createdAt: "2026-09-28",
    receipts: [
      { id: "r-11", vendor: "Metro Taxi Co.", date: "2026-09-04", glAccount: "Travel", tax: 3.2, amount: 38.4, source: "WhatsApp", note: "expense for Sam" },
      { id: "r-12", vendor: "Harbour Bistro", date: "2026-09-11", glAccount: "Meals & Entertainment", tax: 9.75, amount: 84.5, source: "Upload" },
      { id: "r-13", vendor: "Staples", date: "2026-09-19", glAccount: "Office Supplies", tax: 4.1, amount: 35.6, source: "Email" },
    ],
  },
  {
    id: "cl-2",
    claimant: "Maria Gonzalez",
    month: "2026-09",
    status: "awaiting_review",
    createdAt: "2026-09-30",
    receipts: [
      { id: "r-21", vendor: "Northline Rail", date: "2026-09-08", glAccount: "Travel", tax: 14.3, amount: 124.0, source: "Email" },
      { id: "r-22", vendor: "Parkside Hotel", date: "2026-09-08", glAccount: "Travel", tax: 27.6, amount: 239.2, source: "Upload" },
    ],
  },
  {
    id: "cl-3",
    claimant: "Jordan Lee",
    month: "2026-08",
    status: "awaiting_reimbursement",
    createdAt: "2026-08-31",
    approvedAt: "2026-09-02",
    publishedAt: "2026-09-02",
    receipts: [
      { id: "r-31", vendor: "City Parking", date: "2026-08-14", glAccount: "Motor Vehicle Expenses", tax: 2.6, amount: 22.0, source: "WhatsApp" },
      { id: "r-32", vendor: "Office Depot", date: "2026-08-21", glAccount: "Office Supplies", tax: 7.15, amount: 61.99, source: "Upload" },
    ],
  },
  {
    id: "cl-4",
    claimant: "Sam Patel",
    month: "2026-08",
    status: "paid",
    createdAt: "2026-08-30",
    approvedAt: "2026-09-01",
    publishedAt: "2026-09-01",
    paidAt: "2026-09-05",
    receipts: [
      { id: "r-41", vendor: "Cloud Hosting Ltd", date: "2026-08-03", glAccount: "Software & Subscriptions", tax: 5.2, amount: 45.0, source: "Email" },
      { id: "r-42", vendor: "Metro Taxi Co.", date: "2026-08-17", glAccount: "Travel", tax: 2.4, amount: 28.8, source: "WhatsApp" },
    ],
  },
];

// Receipts that were scanned but not yet posted or attached to a claim —
// the pool the "New expense claim" wizard picks from.
export const MOCK_UNPOSTED_RECEIPTS: ClaimReceipt[] = [
  { id: "u-1", vendor: "Corner Café", date: "2026-10-02", glAccount: "Meals & Entertainment", tax: 1.9, amount: 16.4, source: "WhatsApp", note: "client coffee" },
  { id: "u-2", vendor: "Metro Taxi Co.", date: "2026-10-03", glAccount: "Travel", tax: 3.6, amount: 31.2, source: "Upload" },
  { id: "u-3", vendor: "Best Electronics", date: "2026-10-06", glAccount: "Computer Equipment", tax: 18.2, amount: 158.0, source: "Email" },
  { id: "u-4", vendor: "Fuel Stop", date: "2026-10-07", glAccount: "Motor Vehicle Expenses", tax: 7.8, amount: 67.5, source: "WhatsApp" },
  { id: "u-5", vendor: "Print Shop", date: "2026-10-09", glAccount: "Printing & Stationery", tax: 2.9, amount: 25.3, source: "Upload" },
];

export const MOCK_DRIVERS: Driver[] = [
  { id: "d-sam", name: "Sam Patel" },
  { id: "d-maria", name: "Maria Gonzalez" },
  { id: "d-jordan", name: "Jordan Lee" },
];

export const MOCK_VEHICLES: Vehicle[] = [
  { id: "v-1", name: "Sam's Corolla", fuelType: "Hybrid", ownership: "personal" },
  { id: "v-2", name: "Company van", fuelType: "Diesel", ownership: "company" },
  { id: "v-3", name: "Pool EV", fuelType: "Electric", ownership: "company" },
];

export const MOCK_RATES: MileageRates = { perKm: 0.7, passengerPerKm: 0.04 };

export const MOCK_JOURNEYS: Journey[] = [
  {
    id: "j-1",
    date: "2026-10-01",
    driverId: "d-sam",
    vehicleId: "v-1",
    start: "M5V 2T6",
    end: "L5B 3C2",
    returnTrip: true,
    km: 64,
    rate: 0.7,
    passenger: false,
    passengerRate: 0.04,
    purpose: "Client site visit — quarterly review",
    status: "Draft",
  },
  {
    id: "j-2",
    date: "2026-09-24",
    driverId: "d-maria",
    vehicleId: "v-2",
    start: "M4W 1A8",
    end: "L1H 7K4",
    returnTrip: false,
    km: 58,
    rate: 0.7,
    passenger: true,
    passengerRate: 0.04,
    purpose: "Equipment delivery",
    status: "Published",
  },
  {
    id: "j-3",
    date: "2026-09-18",
    driverId: "d-jordan",
    vehicleId: "v-3",
    start: "M6K 3P6",
    end: "N2L 3G1",
    returnTrip: true,
    km: 214,
    rate: 0.7,
    passenger: false,
    passengerRate: 0.04,
    purpose: "Supplier meeting",
    status: "Draft",
  },
];
