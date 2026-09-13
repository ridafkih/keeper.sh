import type { DetailChoice } from "./setup-draft";

export const DETAIL_LABELS: Record<DetailChoice, string> = {
  busy: "Busy",
  calendar_name: "their calendar's name",
  titles: "their real titles",
};

export const DETAIL_ORDER: readonly DetailChoice[] = ["calendar_name", "busy", "titles"];
