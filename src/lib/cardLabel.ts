// How a saved card is named on the billing pages: "Visa •••• 4242".

const BRAND_NAMES: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover" };

export interface CardSummary {
  brand: string;
  last4: string;
}

export const cardLabel = (card: CardSummary) => `${BRAND_NAMES[card.brand] ?? card.brand} •••• ${card.last4}`;
