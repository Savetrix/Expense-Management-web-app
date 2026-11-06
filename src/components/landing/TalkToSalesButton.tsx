"use client";

import { useState, type ReactNode } from "react";

import { CustomPlanEnquiryModal } from "@/components/subscription/CustomPlanEnquiryModal";

// "Talk to sales" on the pricing Custom plan and in the closing CTA. It opens the
// same enquiry form as the in-app /plans page, recorded as coming from the
// landing page. A button, not a link: it opens a dialog and goes nowhere. The
// modal returns focus to this button when it closes.
export function TalkToSalesButton({ className, children }: { className: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && <CustomPlanEnquiryModal onClose={() => setOpen(false)} surface="landing" />}
    </>
  );
}
