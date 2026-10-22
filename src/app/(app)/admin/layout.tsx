import type { ReactNode } from "react";

import { AdminShellV2 } from "@/components/v2/admin/AdminShellV2";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShellV2>{children}</AdminShellV2>;
}
