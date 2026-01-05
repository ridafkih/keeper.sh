import type { ReactNode } from "react";
import { Header } from "@/components/header";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { ToastProvider } from "@/components/toast-provider";
import { ConsentBanner } from "@/components/consent-banner";

export default function DashboardLayout({ children }: { children: React.ReactNode }): ReactNode {
  return (
    <ToastProvider>
      <Header />
      <main className="flex-1 flex flex-col min-h-0">
        <div className="flex gap-2 max-w-3xl mx-auto p-4 flex-1 min-h-0 w-full">
          <DashboardSidebar />
          <div className="flex-1 min-w-0 min-h-0 flex flex-col pb-12">{children}</div>
        </div>
      </main>
      <ConsentBanner />
    </ToastProvider>
  );
}
