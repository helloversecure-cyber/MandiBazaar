import { redirect } from "next/navigation";

/** Legacy /sell → unified Store page (signup tab) */
export default function SellRedirectPage() {
  redirect("/store?tab=signup");
}
