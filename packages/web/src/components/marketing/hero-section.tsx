import type { FC } from "react";
import { button } from "@/styles";
import Link from "next/link";

export const HeroSection: FC = () => (
  <section className="flex flex-col gap-2">
    <h1 className="text-4xl font-semibold tracking-tighter leading-tight text-foreground">
      Simple, open-source calendar syncing
    </h1>
    <p className="text-foreground-secondary leading-relaxed max-w-[48ch]">
      Aggregate events from multiple calendars into one anonymized feed. Push events to one or many
      calendars.
    </p>
    <div className="flex gap-2">
      <Link
        href="https://github.com/ridafkih/keeper.sh"
        target="_blank"
        className={button({ size: "xs", variant: "primary" })}
      >
        View GitHub
      </Link>
    </div>
  </section>
);
