export interface SidebarLocation {
  pathname: string;
  index: number;
}

export type SidebarDirection = "forward" | "back";

const normalizePath = (pathname: string): string => pathname.replace(/\/+$/, "") || "/";

const isAncestorPath = (ancestor: string, pathname: string): boolean =>
  pathname.startsWith(`${ancestor}/`);

export function resolveSidebarDirection(from: SidebarLocation, to: SidebarLocation): SidebarDirection {
  const popped = to.index < from.index;
  if (popped || isAncestorPath(normalizePath(to.pathname), normalizePath(from.pathname))) return "back";
  return "forward";
}
