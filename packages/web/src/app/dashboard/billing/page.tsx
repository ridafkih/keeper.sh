import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { BillingPageContent } from "./billing-page-content";
import { isCommercialMode } from "@/config/mode";

const BillingPage = (): ReactNode => {
  if (!isCommercialMode) {
    redirect("/dashboard");
  }

  return <BillingPageContent />;
};

export default BillingPage;
