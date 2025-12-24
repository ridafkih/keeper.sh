import type { FC } from "react";
import Link from "next/link";
import { Button } from "@base-ui/react/button";
import { button } from "@/styles";

export const HeroSection: FC = () => (
  <section className="flex flex-col items-center gap-6 py-16">
    <h1 className="text-center text-4xl font-bold tracking-tighter leading-tight max-w-[20ch]">
      Simple, open-source <span className="text-nowrap">calendar syncing</span>
    </h1>
    <p className="text-center text-foreground-secondary leading-relaxed max-w-[42ch]">
      Aggregate events from multiple calendars into one anonymized feed. Push to
      any calendar that supports iCal.
    </p>
    <div className="flex gap-3">
      <Button
        render={<Link href="/register" />}
        nativeButton={false}
        className={button({ variant: "primary" })}
      >
        Get Started
      </Button>
      <Button
        render={<Link href="/features" />}
        nativeButton={false}
        className={button({ variant: "secondary" })}
      >
        Learn More
      </Button>
    </div>
  </section>
);
