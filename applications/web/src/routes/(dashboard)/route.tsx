import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { AnimatePresence, LazyMotion } from "motion/react";
import { loadMotionFeatures } from "@/lib/motion-features";
import * as m from "motion/react-m";
import { popoverOverlayAtom } from "@/state/popover-overlay";
import { SyncProvider } from "@/providers/sync-provider";
import { resolveDashboardRedirect } from "@/lib/route-access-guards";
import { CalendarView } from "@/features/dashboard/components/calendar-view";

export const Route = createFileRoute("/(dashboard)")({
  beforeLoad: ({ context }) => {
    const redirectTarget = resolveDashboardRedirect(context.auth.hasSession());
    if (redirectTarget) {
      throw redirect({ to: redirectTarget });
    }
  },
  component: DashboardLayout,
  head: () => ({
    meta: [{ content: "noindex, nofollow", name: "robots" }],
    links: [
      {
        rel: "preload",
        href: "/assets/fonts/GeistMono-variable.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),
});

function DashboardLayout() {
  const overlayActive = useAtomValue(popoverOverlayAtom);

  return (
    <div className="relative flex min-h-dvh justify-center lg:justify-start lg:gap-4 lg:p-4">
      {/* Sidebar — the existing centered dashboard column. */}
      <div className="relative flex w-full max-w-sm shrink-0 flex-col gap-3 px-4 pb-12 pt-4 xs:pt-[min(6rem,25vh)] lg:h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:px-1 lg:pt-6">
        <LazyMotion features={loadMotionFeatures}>
          <AnimatePresence>
            {overlayActive && (
              <m.div
                className="fixed inset-0 z-10 backdrop-blur-[2px] bg-black/5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            )}
          </AnimatePresence>
        </LazyMotion>
        <SyncProvider />
        <Outlet />
      </div>
      {/* Calendar pane — desktop only. */}
      <div className="hidden lg:flex lg:h-[calc(100dvh-2rem)] lg:min-w-0 lg:flex-1">
        <CalendarView />
      </div>
    </div>
  );
}
