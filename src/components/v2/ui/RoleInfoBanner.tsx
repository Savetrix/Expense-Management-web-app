import { Info } from "lucide-react";
import { ReactNode } from "react";

interface RoleInfoBannerProps {
  children: ReactNode;
}

// Tinted info bar for contributor/read-only access copy — GL Account & Tax
// Code and Vendors carry near-identical markup/copy for this in the Stitch
// export ("You have contributor access on X and can view Y but not manage
// them"); callers pass the screen-specific copy as children.
export function RoleInfoBanner({ children }: RoleInfoBannerProps) {
  return (
    <div className="flex items-start gap-[var(--space-sm)] rounded-md border border-status-info-border bg-status-info-bg px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-status-info-text">
      <Info size={18} strokeWidth={2} className="mt-0.5 shrink-0" />
      <p>{children}</p>
    </div>
  );
}
