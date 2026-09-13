import { useLayoutEffect, useRef, type RefObject } from "react";
import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { AnimatePresence, LazyMotion } from "motion/react";
import { loadMotionFeatures } from "@/lib/motion-features";
import * as m from "motion/react-m";
import { popoverOverlayAtom } from "@/state/popover-overlay";
import { SyncProvider } from "@/providers/sync-provider";
import { resolveDashboardRedirect } from "@/lib/route-access-guards";
import { CalendarView } from "@/features/dashboard/components/calendar-view";
import { SidebarPageTransition } from "@/features/dashboard/components/sidebar-page-transition";
import { isWideSidebarPath } from "@/lib/sidebar-width";
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

const SIDEBAR_REM = { narrow: 24, wide: 32 };
const GAP_REM = 1;
const RELEASE_FALLBACK_MS = 400;

/* The week grid re-measures on every width it is given, so while the sidebar tweens the calendar is
   pinned at its final width, right-aligned and clipped: it snaps once and the sidebar moves over it. */
function usePinnedCalendarWidth(
  wide: boolean,
  sidebarRef: RefObject<HTMLDivElement | null>,
  paneRef: RefObject<HTMLDivElement | null>,
  calendarRef: RefObject<HTMLDivElement | null>,
) {
  const previous = useRef(wide);

  useLayoutEffect(() => {
    if (previous.current === wide) return;
    previous.current = wide;
    const sidebar = sidebarRef.current;
    const pane = paneRef.current;
    const calendar = calendarRef.current;
    const root = sidebar?.parentElement;
    if (!sidebar || !pane || !calendar || !root || pane.clientWidth === 0) return;

    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const rootStyle = getComputedStyle(root);
    const content = root.clientWidth - Number.parseFloat(rootStyle.paddingLeft) - Number.parseFloat(rootStyle.paddingRight);
    const sidebarWidth = (wide ? SIDEBAR_REM.wide : SIDEBAR_REM.narrow) * rem;
    calendar.style.width = `${content - sidebarWidth - GAP_REM * rem}px`;
    pane.style.overflow = "hidden";
    pane.style.justifyContent = "flex-end";

    const release = () => {
      calendar.style.width = "";
      pane.style.overflow = "";
      pane.style.justifyContent = "";
      sidebar.removeEventListener("transitionend", release);
    };
    sidebar.addEventListener("transitionend", release);
    const fallback = setTimeout(release, RELEASE_FALLBACK_MS);
    return () => {
      clearTimeout(fallback);
      release();
    };
  }, [wide, sidebarRef, paneRef, calendarRef]);
}

function DashboardLayout() {
  const overlayActive = useAtomValue(popoverOverlayAtom);
  const wide = useRouterState({ select: (state) => isWideSidebarPath(state.location.pathname) });
  const sidebarRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  usePinnedCalendarWidth(wide, sidebarRef, paneRef, calendarRef);

  return (
    <div className="relative flex min-h-dvh justify-center lg:justify-start lg:gap-4 lg:p-4">
      <div
        ref={sidebarRef}
        className={cn(
          "relative flex w-full shrink-0 flex-col gap-3 px-4 pb-(--sidebar-pad-b) pt-4 [--sidebar-pad-b:3rem] [--sidebar-pad-t:1.5rem] [--sidebar-pad-x:0.25rem] xs:pt-[min(6rem,25vh)] lg:h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:px-(--sidebar-pad-x) lg:pt-(--sidebar-pad-t)",
          "transition-[max-width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
          wide ? "max-w-lg" : "max-w-sm",
        )}
      >
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
        <SidebarPageTransition>
          <Outlet />
        </SidebarPageTransition>
      </div>
      {/* `isolate` keeps the calendar's sticky z-indices under the popover blur overlay (z-10). */}
      <div ref={paneRef} className="hidden lg:flex lg:h-[calc(100dvh-2rem)] lg:min-w-0 lg:flex-1 lg:isolate">
        <div ref={calendarRef} className="flex h-full w-full min-w-0 shrink-0">
          <CalendarView />
        </div>
      </div>
    </div>
  );
}
