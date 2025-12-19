import { Header } from "@/components/header";
import { DashboardSidebar } from "@/components/dashboard-sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />
      <main className="flex-1">
        <div className="flex gap-8 max-w-3xl mx-auto p-4">
          <DashboardSidebar />
          <div className="flex-1">{children}</div>
        </div>
      </main>
    </>
  );
}
