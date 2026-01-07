import type { FC, PropsWithChildren } from "react";

interface MarketingSectionProps {
  id?: string;
  heading?: string | null;
}

export const MarketingSection: FC<PropsWithChildren<MarketingSectionProps>> = ({
  id,
  heading,
  children,
}) => (
  <section id={id} className="flex flex-col gap-4">
    {heading && <h2 className="text-2xl font-medium tracking-tight text-foreground">{heading}</h2>}
    {children}
  </section>
);
