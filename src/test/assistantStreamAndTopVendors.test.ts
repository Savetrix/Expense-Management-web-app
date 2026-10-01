// Two display bugs found while porting these features to iOS.
//
// 1. ChatPanel stripped the consent frame from each streamed chunk on its own.
//    A frame split across chunks then leaked: the first chunk showed
//    "\u001fSAVET", and the second half has no marker at all, so the ticket
//    itself was rendered and saved into chat history.
// 2. computeTopVendors keyed by vendor alone, adding a vendor's USD and CAD
//    bills into one total.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONFIRM_MARKER,
  CONSENT_FRAME_PREFIX,
  CONSENT_FRAME_SUFFIX,
  extractConsentTicket,
  stripConsentFrame,
} from "../lib/chatbot/confirmMarker";
import { computeTopVendors } from "../lib/topVendors";
import type { InvoiceRecord } from "../store/invoice/invoiceSlice";

/** What ChatPanel's stream loop now renders: visible text from the whole reply, new part appended. */
function render(chunks: string[]): string {
  let raw = "";
  let shown = "";
  for (const chunk of chunks) {
    raw += chunk;
    const visible = stripConsentFrame(raw);
    if (visible.length > shown.length) shown = visible;
  }
  return shown;
}

describe("assistant consent frame", () => {
  const ticket = "v1.req-1.1790000000000.abc123";
  const frame = `${CONSENT_FRAME_PREFIX}${ticket}${CONSENT_FRAME_SUFFIX}`;

  it("never renders any part of a frame split across chunks", () => {
    const reply = `Deactivate Acme Corp? ${CONFIRM_MARKER}`;
    for (let cut = 1; cut < frame.length; cut += 1) {
      const shown = render([reply, frame.slice(0, cut), frame.slice(cut)]);
      assert.equal(shown, reply, `leaked with the frame split at ${cut}`);
    }
  });

  it("would have leaked under the old per-chunk stripping", () => {
    // The old behaviour, kept here to show what the test guards against.
    const oldStrip = (text: string) => text.replace(new RegExp(`${CONSENT_FRAME_PREFIX}[^${CONSENT_FRAME_SUFFIX}]*${CONSENT_FRAME_SUFFIX}`), "").split(CONSENT_FRAME_PREFIX)[0];
    const parts = ["Ok. ", frame.slice(0, 6), frame.slice(6)];
    assert.ok(parts.map(oldStrip).join("").includes(ticket));
  });

  it("still finds the ticket in the full reply", () => {
    assert.equal(extractConsentTicket(`Done.${frame}`), ticket);
  });
});

describe("top vendors", () => {
  const inv = (vendorName: string, totalAmount: number, currency: string): InvoiceRecord =>
    ({
      _id: `${vendorName}-${currency}-${totalAmount}`,
      postedStatus: "auto",
      createdAt: new Date().toISOString(),
      extractedData: { vendorName, totalAmount, currency, invoiceDate: new Date().toISOString().slice(0, 10) },
    }) as InvoiceRecord;

  it("keeps a vendor's currencies apart", () => {
    const { vendors } = computeTopVendors([inv("Acme", 500, "USD"), inv("Acme", 300, "CAD"), inv("Beta", 50, "USD")]);
    const acme = vendors.filter((v) => v.vendor === "Acme").map((v) => [v.currency, v.total]).sort();
    assert.deepEqual(acme, [["CAD", 300], ["USD", 500]]);
  });

  it("still adds up a vendor's bills in one currency", () => {
    const { vendors } = computeTopVendors([inv("Acme", 500, "USD"), inv("Acme", 250, "USD"), inv("Beta", 50, "USD"), inv("Gamma", 5, "USD")]);
    assert.deepEqual(vendors[0], { vendor: "Acme", total: 750, currency: "USD" });
  });
});
