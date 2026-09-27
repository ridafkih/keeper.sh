import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { AnimatePresence, LazyMotion, useReducedMotion } from "motion/react";
import { loadMotionFeatures } from "@/lib/motion-features";
import * as m from "motion/react-m";
import { popoverOverlayAtom } from "@/state/popover-overlay";
import { SyncProvider } from "@/providers/sync-provider";
import { resolveDashboardRedirect } from "@/lib/route-access-guards";
import { CalendarView } from "@/features/dashboard/components/calendar-view";
import { SidebarPageTransition } from "@/features/dashboard/components/sidebar-page-transition";
import { useSettledPathname } from "@/hooks/use-settled-pathname";
import { isFullScreenPath, isSyncsListPath, resolveSyncPane, type SyncPane } from "@/lib/sidebar-width";
import { SyncsListPanel } from "@/features/syncs/components/syncs-list-panel";
import { SyncPage, type SyncTab } from "@/features/syncs/components/sync-page";
import { NewSyncPage } from "@/features/syncs/components/new-sync-page";
import { readNewSyncSearch } from "@/features/syncs/sync-draft";
import { cn } from "@/utils/cn";

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

function PopoverOverlay() {
  const overlayActive = useAtomValue(popoverOverlayAtom);
  return (
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
  );
}

const PANE_HIDDEN = { opacity: 0, y: 6 };
const PANE_SHOWN = { opacity: 1, y: 0 };
const PANE_LEAVING = { opacity: 0, y: -6 };
const PANE_TRANSITION = { duration: 0.2, ease: [0.2, 0, 0, 1] as const };
const PANE_INSTANT = { duration: 0 };

const readSyncTab = (search: Record<string, unknown>): SyncTab => (search.tab === "activity" ? "activity" : "setup");

// Sync pages are drawn here rather than through the outlet, so the outgoing one keeps its own sync while it fades away.
function DashboardMainPane({ pane }: { pane: SyncPane | null }) {
  const reduceMotion = useReducedMotion() ?? false;
  const search = useRouterState({ select: (state) => state.location.search as Record<string, unknown> });
  const transition = reduceMotion ? PANE_INSTANT : PANE_TRANSITION;

  return (
    <LazyMotion features={loadMotionFeatures}>
      <AnimatePresence mode="popLayout" initial={false}>
        {pane ? (
          <m.div
            key={pane.kind === "new" ? "sync:new" : `sync:${pane.syncId}`}
            className="relative flex w-full max-w-lg min-w-0 flex-col px-4 pt-4 pb-(--sidebar-pad-b) [--sidebar-pad-b:3rem] [--sidebar-pad-t:1.5rem] [--sidebar-pad-x:0.25rem] xs:pt-[min(6rem,25vh)] lg:h-[calc(100dvh-2rem)] lg:max-w-none lg:flex-1 lg:overflow-y-auto lg:rounded-2xl lg:border lg:border-border-elevated lg:bg-background lg:px-(--sidebar-pad-x) lg:pt-(--sidebar-pad-t) lg:shadow-xs lg:[--sidebar-pad-t:1.25rem] lg:[--sidebar-pad-x:2rem]"
            initial={PANE_HIDDEN}
            animate={PANE_SHOWN}
            exit={PANE_LEAVING}
            transition={transition}
          >
            {pane.kind === "new"
              ? <NewSyncPage search={readNewSyncSearch(search)} />
              : <SyncPage syncId={pane.syncId} tab={readSyncTab(search)} />}
          </m.div>
        ) : (
          // `isolate` keeps the calendar's sticky z-indices under the popover blur overlay (z-10).
          <m.div
            key="calendar"
            className="hidden lg:flex lg:h-[calc(100dvh-2rem)] lg:min-w-0 lg:flex-1 lg:isolate"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
          >
            <CalendarView />
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}

function DashboardLayout() {
  const fullScreen = isFullScreenPath(useSettledPathname());
  if (fullScreen) return <FullScreenLayout />;
  return <SidebarLayout />;
}

function FullScreenLayout() {
  return (
    <div className="relative min-h-dvh w-full px-4 pt-4 pb-12 xs:pt-[min(6rem,25vh)] lg:px-10 lg:pt-12">
      <PopoverOverlay />
      <SyncProvider />
      <Outlet />
    </div>
  );
}

function SidebarLayout() {
  const pathname = useSettledPathname();
  const pane = resolveSyncPane(pathname);
  const syncsList = pane !== null || isSyncsListPath(pathname);

  return (
    <div className="relative flex min-h-dvh justify-center lg:justify-start lg:gap-4 lg:p-4">
      <PopoverOverlay />
      <div
        className={cn(
          "relative flex w-full max-w-sm shrink-0 flex-col gap-3 px-4 pb-(--sidebar-pad-b) pt-4 [--sidebar-pad-b:3rem] [--sidebar-pad-t:1.5rem] [--sidebar-pad-x:0.25rem] xs:pt-[min(6rem,25vh)] lg:h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:px-(--sidebar-pad-x) lg:pt-(--sidebar-pad-t)",
          pane && "hidden lg:flex",
        )}
      >
        <SyncProvider />
        <SidebarPageTransition>
          {syncsList ? <SyncsListPanel active={pane} /> : <Outlet />}
        </SidebarPageTransition>
      </div>
      <DashboardMainPane pane={pane} />
    </div>
  );
}
