import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { AnimatePresence, LazyMotion, useReducedMotion } from "motion/react";
import { loadMotionFeatures } from "@/lib/motion-features";
import * as m from "motion/react-m";
import { popoverOverlayAtom } from "@/state/popover-overlay";
import { sidebarResizingAtom } from "@/state/sidebar-resizing";
import { SyncProvider } from "@/providers/sync-provider";
import { resolveDashboardRedirect } from "@/lib/route-access-guards";
import { CalendarView } from "@/features/dashboard/components/calendar-view";
import { SidebarPageTransition } from "@/features/dashboard/components/sidebar-page-transition";
import { isFullScreenPath, isSyncDetailPath, isSyncsListPath, isWideSidebarPath } from "@/lib/sidebar-width";
import { SyncsListPanel } from "@/features/syncs/components/syncs-list-panel";
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

const RESIZE_FALLBACK_MS = 400;

// Flags the tween so the week grid can suspend scroll snapping instead of re-snapping every frame.
function useSidebarResizing(wide: boolean, sidebarRef: RefObject<HTMLDivElement | null>) {
  const setResizing = useSetAtom(sidebarResizingAtom);
  const previous = useRef(wide);

  useLayoutEffect(() => {
    if (previous.current === wide) return;
    previous.current = wide;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    setResizing(true);
    const settle = () => {
      setResizing(false);
      sidebar.removeEventListener("transitionend", settle);
    };
    sidebar.addEventListener("transitionend", settle);
    const fallback = setTimeout(settle, RESIZE_FALLBACK_MS);
    return () => {
      clearTimeout(fallback);
      settle();
    };
  }, [wide, sidebarRef, setResizing]);
}

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

const PANE_ENTER = { opacity: 0, y: 6 };
const PANE_SHOWN = { opacity: 1, y: 0 };
const PANE_TRANSITION = { duration: 0.2, ease: [0.2, 0, 0, 1] as const };

function DetailPaneTransition({ pathname, children }: { pathname: string; children: ReactNode }) {
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <LazyMotion features={loadMotionFeatures}>
      <m.div key={pathname} initial={reduceMotion ? false : PANE_ENTER} animate={PANE_SHOWN} transition={PANE_TRANSITION}>
        {children}
      </m.div>
    </LazyMotion>
  );
}

function DashboardLayout() {
  const fullScreen = useRouterState({ select: (state) => isFullScreenPath(state.location.pathname) });
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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const wide = isWideSidebarPath(pathname);
  const syncDetail = isSyncDetailPath(pathname);
  const syncsList = syncDetail || isSyncsListPath(pathname);
  const sidebarRef = useRef<HTMLDivElement>(null);
  useSidebarResizing(wide, sidebarRef);

  return (
    <div className="relative flex min-h-dvh justify-center lg:justify-start lg:gap-4 lg:p-4">
      <PopoverOverlay />
      <div
        ref={sidebarRef}
        className={cn(
          "relative flex w-full shrink-0 flex-col gap-3 px-4 pb-(--sidebar-pad-b) pt-4 [--sidebar-pad-b:3rem] [--sidebar-pad-t:1.5rem] [--sidebar-pad-x:0.25rem] xs:pt-[min(6rem,25vh)] lg:h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:px-(--sidebar-pad-x) lg:pt-(--sidebar-pad-t)",
          syncDetail && "hidden lg:flex",
          "transition-[max-width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
          wide ? "max-w-lg" : "max-w-sm",
        )}
      >
        <SyncProvider />
        <SidebarPageTransition>
          {syncsList ? <SyncsListPanel activeSyncId={syncDetail ? pathname.split("/").pop() : undefined} /> : <Outlet />}
        </SidebarPageTransition>
      </div>
      {syncDetail ? (
        // One mounted page that is the whole column on small screens and takes the calendar's place from lg.
        <div className="relative flex w-full max-w-lg min-w-0 flex-col px-4 pt-4 pb-(--sidebar-pad-b) [--sidebar-pad-b:3rem] [--sidebar-pad-t:1.5rem] [--sidebar-pad-x:0.25rem] xs:pt-[min(6rem,25vh)] lg:h-[calc(100dvh-2rem)] lg:max-w-none lg:flex-1 lg:overflow-y-auto lg:rounded-2xl lg:border lg:border-border-elevated lg:bg-background lg:px-(--sidebar-pad-x) lg:pt-(--sidebar-pad-t) lg:shadow-xs lg:[--sidebar-pad-t:1.25rem] lg:[--sidebar-pad-x:2rem]">
          <DetailPaneTransition pathname={pathname}>
            <Outlet />
          </DetailPaneTransition>
        </div>
      ) : (
        // `isolate` keeps the calendar's sticky z-indices under the popover blur overlay (z-10).
        <div className="hidden lg:flex lg:h-[calc(100dvh-2rem)] lg:min-w-0 lg:flex-1 lg:isolate">
          <CalendarView />
        </div>
      )}
    </div>
  );
}
