import type { PropsWithChildren } from "react";

export function MarketingCtaSection({ children }: PropsWithChildren) {
  return (
    <section className="w-full pt-16 pb-8">
      {children}
    </section>
  );
}

export function MarketingCtaCard({ children }: PropsWithChildren) {
  return (
    <div className="relative rounded-2xl p-0.5 bg-neutral-800 dark:bg-neutral-900 before:absolute before:top-0.5 before:inset-x-0 before:h-px before:bg-linear-to-r before:mx-4 before:z-10 before:from-transparent before:via-neutral-600 dark:before:via-neutral-700 before:to-transparent">
      <div className="rounded-[0.875rem] bg-linear-to-t to-neutral-800 from-neutral-900 dark:to-neutral-900 dark:from-neutral-950 p-8 flex flex-col items-center gap-2">
        {children}
      </div>
    </div>
  );
}
