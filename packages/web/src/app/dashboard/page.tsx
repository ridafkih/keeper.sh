import { Suspense } from "react";
import type { ReactNode } from "react";
import { CalendarSkeleton } from "@/components/calendar";
import { CalendarFeed } from "@/components/calendar-feed";

export default function DashboardPage(): ReactNode {
  return (
    <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
      <Suspense fallback={<CalendarSkeleton days={7} />}>
        <CalendarFeed />
      </Suspense>
    </div>
  );
}
