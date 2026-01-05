import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { BillingPageContent } from "./billing-page-content";
import { isCommercialMode } from "@/config/mode";

export default function BillingPage(): ReactNode {
  if (!isCommercialMode) {
    redirect("/dashboard");
  }

  return <BillingPageContent />;
}
