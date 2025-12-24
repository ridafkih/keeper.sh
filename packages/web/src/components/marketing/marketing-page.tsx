import type { FC, PropsWithChildren } from "react";
import { Header } from "@/components/header";

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
    <main className="flex flex-col gap-4 max-w-3xl mx-auto py-12 px-5 pb-16 w-full">
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
  </>
);
