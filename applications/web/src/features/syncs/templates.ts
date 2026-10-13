import type { SyncDefinition } from "@keeper.sh/data-schemas";

export type SyncTemplateKey = "block_my_time" | "share_with_family" | "work_copy" | "hide_the_details";

export interface SyncTemplate {
  description: string;
  name: string;
  spec: string;
  // The spec a free plan gets: what the profile still does, then what Pro adds to it.
  lockedSpec: string;
  requiresPro: boolean;
  values: Partial<SyncDefinition>;
}

export const SYNC_TEMPLATES: Record<SyncTemplateKey, SyncTemplate> = {
  block_my_time: {
    description: "Every calendar blocks the others, so nobody double-books you.",
    lockedSpec: "Both ways · Busy Only · Pro adds skipping all-day and focus time",
    name: "Block My Time",
    requiresPro: true,
    spec: "Both ways · Busy Only · skips all-day and focus time",
    values: { mode: "both_ways", shareAs: "busy_only", skipAllDay: true, skipFocusTime: true },
  },
  hide_the_details: {
    description: "Titles come across. Notes and locations stay behind.",
    lockedSpec: "One way · Busy Only · Pro adds Title Only",
    name: "Hide the Details",
    requiresPro: true,
    spec: "One way · Title Only",
    values: { mode: "one_way", shareAs: "title_only" },
  },
  share_with_family: {
    description: "Family sees what you're doing, without notes or locations.",
    lockedSpec: "One way · Busy Only · Pro adds Title Only and private copies",
    name: "Share With Family",
    requiresPro: true,
    spec: "One way · Title Only · private copies",
    values: { markPrivate: true, mode: "one_way", shareAs: "title_only" },
  },
  work_copy: {
    description: "A full, private copy of work events on another calendar.",
    lockedSpec: "One way · Busy Only · Pro adds Full Details and private copies",
    name: "Work Copy",
    requiresPro: true,
    spec: "One way · Full Details · private copies",
    values: { markPrivate: true, mode: "one_way", shareAs: "full" },
  },
};

export const SYNC_TEMPLATE_ORDER: SyncTemplateKey[] = ["block_my_time", "share_with_family", "work_copy", "hide_the_details"];

// Checked against the list rather than with `in`, which would also accept Object.prototype keys.
export const isSyncTemplateKey = (value: unknown): value is SyncTemplateKey =>
  typeof value === "string" && SYNC_TEMPLATE_ORDER.some((key) => key === value);
