import { useRouterState, type RouterState } from "@tanstack/react-router";

// Matches swap when the loader resolves, later than `location`; whatever picks what the sidebar shows reads this, so it swaps with the transition.
export const settledPathnameOf = (state: RouterState): string =>
  state.matches[state.matches.length - 1]?.pathname ?? state.location.pathname;

export function useSettledPathname(): string {
  return useRouterState({ select: settledPathnameOf });
}
