import type { FC, PropsWithChildren } from "react";
import { Header } from "@/components/header";
import { Footer } from "./footer";

interface MarketingPageProps {
  title?: string;
  description?: string;
}

export const MarketingPage: FC<PropsWithChildren<MarketingPageProps>> = ({
  title,
  description,
  children,
}) => (
  <>
    <Header />
    <main className="flex flex-col gap-8 max-w-3xl mx-auto p-4 w-full">
      {title && (
        <div>
          <h1 className="text-3xl font-medium tracking-tight text-foreground mb-2">
            {title}
          </h1>
          {description && (
            <p className="text-foreground-secondary">{description}</p>
          )}
        </div>
      )}
      {children}
    </main>
    <Footer />
  </>
);
