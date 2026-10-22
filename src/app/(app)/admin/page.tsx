import { redirect } from "next/navigation";

// /admin opens its first section.
export default function AdminPage() {
  redirect("/admin/coupons");
}
