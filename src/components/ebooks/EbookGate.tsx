"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { EbookGateModal } from "@/components/ebooks/EbookGateModal";
import type { EbookIntent } from "@/lib/ebookLeads/fields";

// The gate in front of an e-book's web text and PDF. One provider per reading
// page owns the single details dialog; any number of GateButtons inside it ask
// for access, so the hero, the locked panel and the sidebar all share one dialog
// and one unlocked state.
//
// IMPORTANT: this file takes the e-book's slug and title only, never its text.
// The text is rendered by the server page and passed in as `children` ONLY when
// the visitor has the access cookie, so it never reaches a locked visitor's
// browser, and nothing here may import the content.

interface GateContext {
  unlocked: boolean;
  request: (intent: EbookIntent) => void;
}

const Gate = createContext<GateContext | null>(null);

function useGate(): GateContext {
  const value = useContext(Gate);
  if (!value) throw new Error("GateButton must be used inside EbookGateProvider");
  return value;
}

interface EbookGateProviderProps {
  slug: string;
  title: string;
  /** From the server: does this visitor already have the access cookie? */
  unlocked: boolean;
  /** From ?gate=: open the dialog on arrival (the card's PDF link does this). */
  autoOpen: EbookIntent | null;
  children: ReactNode;
}

export function EbookGateProvider({ slug, title, unlocked, autoOpen, children }: EbookGateProviderProps) {
  const router = useRouter();
  const [dialogIntent, setDialogIntent] = useState<EbookIntent | null>(unlocked ? null : autoOpen);
  // True from the moment the form is accepted until the refreshed page (which
  // now carries the cookie) arrives with `unlocked` set, so the buttons behave
  // as unlocked immediately instead of re-opening the dialog.
  const [justUnlocked, setJustUnlocked] = useState(false);
  const scrollAfterRefresh = useRef(false);

  const isUnlocked = unlocked || justUnlocked;
  const downloadHref = `/ebooks/${slug}/download`;

  const scrollToContent = useCallback(() => {
    document.getElementById("content")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const request = useCallback(
    (intent: EbookIntent) => {
      if (!isUnlocked) {
        setDialogIntent(intent);
        return;
      }
      if (intent === "download") window.location.assign(downloadHref);
      else scrollToContent();
    },
    [isUnlocked, downloadHref, scrollToContent],
  );

  const handleUnlocked = useCallback(
    (intent: EbookIntent) => {
      setJustUnlocked(true);
      setDialogIntent(null);
      // Re-render the server page now that the cookie exists, so the text appears.
      router.refresh();
      if (intent === "download") {
        // The route answers with Content-Disposition: attachment, so the browser
        // saves the file and this page stays where it is.
        window.location.assign(downloadHref);
      } else {
        scrollAfterRefresh.current = true;
      }
    },
    [router, downloadHref],
  );

  // Once the refreshed page arrives unlocked, bring the text into view.
  useEffect(() => {
    if (unlocked && scrollAfterRefresh.current) {
      scrollAfterRefresh.current = false;
      scrollToContent();
    }
  }, [unlocked, scrollToContent]);

  return (
    <Gate.Provider value={{ unlocked: isUnlocked, request }}>
      {children}
      {dialogIntent && (
        <EbookGateModal
          slug={slug}
          title={title}
          intent={dialogIntent}
          onClose={() => setDialogIntent(null)}
          onUnlocked={handleUnlocked}
        />
      )}
    </Gate.Provider>
  );
}

/** A button that reads or downloads, asking for the details first if needed. */
export function GateButton({
  intent,
  className,
  children,
}: {
  intent: EbookIntent;
  className: string;
  children: ReactNode;
}) {
  const { request } = useGate();
  return (
    <button type="button" className={className} onClick={() => request(intent)}>
      {children}
    </button>
  );
}
