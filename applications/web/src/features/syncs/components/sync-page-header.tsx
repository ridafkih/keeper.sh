import type { ReactNode } from "react";
import { DashboardHeading1 } from "@/components/ui/primitives/dashboard-heading";
import { StickyPageHeader } from "@/components/ui/primitives/sticky-page-header";
import { Text } from "@/components/ui/primitives/text";

interface SyncPageHeaderProps {
  back: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  trailing?: ReactNode;
}

// At lg this mirrors the calendar toolbar: a solid strip, then the same fill dissolving behind the subtitle.
export function SyncPageHeader({ back, title, subtitle, trailing }: SyncPageHeaderProps) {
  return (
    <StickyPageHeader className="gap-1.5 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:grid-rows-[3.5rem_auto] lg:items-center lg:gap-x-3 lg:gap-y-0 lg:pt-0!">
      <div className="lg:hidden">{back}</div>
      <div aria-hidden className="pointer-events-none col-span-full row-start-1 -mx-(--sidebar-pad-x) hidden self-stretch rounded-t-[calc(var(--radius-2xl)-1px)] bg-background-elevated lg:block" />
      <div aria-hidden className="pointer-events-none col-span-full row-start-2 -mx-(--sidebar-pad-x) hidden self-stretch bg-background-elevated mask-b-from-0% lg:block" />
      <DashboardHeading1 className="select-none px-0.5 pt-4 lg:relative lg:col-start-1 lg:row-start-1 lg:pt-0 lg:text-xl">{title}</DashboardHeading1>
      <Text size="sm" tone="muted" className="-mt-0.5 flex items-center gap-2 px-0.5 lg:relative lg:col-span-full lg:row-start-2 lg:mt-0 lg:pt-2 lg:pb-3">
        {subtitle}
      </Text>
      {trailing && <div className="px-0.5 pt-2 lg:relative lg:col-start-2 lg:row-start-1 lg:pt-0">{trailing}</div>}
    </StickyPageHeader>
  );
}
