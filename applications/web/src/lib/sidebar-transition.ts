export interface SidebarLocation {
  pathname: string;
  index: number;
}

export type SidebarDirection = "forward" | "back";

const normalizePath = (pathname: string): string => pathname.replace(/\/+$/, "") || "/";

const isAncestorPath = (ancestor: string, pathname: string): boolean =>
  pathname.startsWith(`${ancestor}/`);

declare module "@tanstack/history" {
  interface HistoryState {
    sidebarDirection?: SidebarDirection;
  }
}

// A replace keeps the history index, so siblings (previous/next) declare their own direction via link state.
export function resolveSidebarDirection(
  from: SidebarLocation,
  to: SidebarLocation,
  declared?: SidebarDirection,
): SidebarDirection {
  if (declared && to.index === from.index) return declared;
  const popped = to.index < from.index;
  if (popped || isAncestorPath(normalizePath(to.pathname), normalizePath(from.pathname))) return "back";
  return "forward";
}
