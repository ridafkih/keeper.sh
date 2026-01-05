import type { ReactNode } from "react";
import { Header } from "@/components/header";
import { Footer } from "@/components/marketing/footer";
import { ConsentBanner } from "@/components/consent-banner";

export default function MarketingLayout({ children }: { children: React.ReactNode }): ReactNode {
  return (
    <>
      <Header />
      <main className="relative flex flex-col gap-8 max-w-3xl mx-auto p-4 px-5 w-full">
        {children}
      </main>
      <Footer />
      <ConsentBanner />
    </>
  );
}
