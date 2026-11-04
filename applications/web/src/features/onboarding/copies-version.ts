import type { CompositeSyncState } from "@/state/sync";

type CopiesVersionSignal = Pick<CompositeSyncState, "mappings" | "state">;

const resolveCopiesVersion = ({ mappings, state }: CopiesVersionSignal): string =>
  `${mappings?.seq ?? 0}:${state}`;

export { resolveCopiesVersion };
