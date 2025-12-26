import type { FC } from "react";

export const HeroSection: FC = () => (
  <section className="flex flex-col gap-2">
    <h1 className="text-4xl font-semibold tracking-tighter leading-tight text-foreground">
      Simple, open-source <span className="text-nowrap">calendar syncing</span>
    </h1>
    <p className="text-foreground-secondary leading-relaxed max-w-[48ch]">
      Aggregate events from multiple calendars into one anonymized feed. Push
      events to your main calendar.
    </p>
  </section>
);
