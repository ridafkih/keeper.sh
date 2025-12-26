import type { FC } from "react";

export const HeroSection: FC = () => (
  <section className="flex flex-col gap-2">
    <h1 className="text-4xl font-semibold tracking-tighter leading-tight">
      Simple, open-source <span className="text-nowrap">calendar syncing</span>
    </h1>
    <p className="text-foreground-secondary leading-relaxed max-w-[42ch]">
      Aggregate events from multiple calendars into one anonymized feed. Push to
      any calendar that supports iCal.
    </p>
  </section>
);
