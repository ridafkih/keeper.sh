import type { SyncDefinition } from "@keeper.sh/data-schemas";

export type SyncTemplateKey = "block_my_time" | "share_with_family" | "work_copy" | "hide_the_details";

export interface SyncTemplate {
  description: string;
  name: string;
  spec: string;
  values: Partial<SyncDefinition>;
}

export const SYNC_TEMPLATES: Record<SyncTemplateKey, SyncTemplate> = {
  block_my_time: {
    description: "Every calendar blocks the others, so nobody double-books you.",
    name: "Block My Time",
    spec: "Both ways · Busy Only · skips all-day and focus time",
    values: { mode: "both_ways", shareAs: "busy_only", skipAllDay: true, skipFocusTime: true },
  },
  hide_the_details: {
    description: "Titles come across. Notes and locations stay behind.",
    name: "Hide the Details",
    spec: "One way · Title Only",
    values: { mode: "one_way", shareAs: "title_only" },
  },
  share_with_family: {
    description: "Family sees what you're doing, without notes or locations.",
    name: "Share With Family",
    spec: "One way · Title Only · private copies",
    values: { markPrivate: true, mode: "one_way", shareAs: "title_only" },
  },
  work_copy: {
    description: "A full, private copy of work events on another calendar.",
    name: "Work Copy",
    spec: "One way · Full Details · private copies",
    values: { markPrivate: true, mode: "one_way", shareAs: "full" },
  },
};

export const SYNC_TEMPLATE_ORDER: SyncTemplateKey[] = ["block_my_time", "share_with_family", "work_copy", "hide_the_details"];

export const isSyncTemplateKey = (value: unknown): value is SyncTemplateKey =>
  typeof value === "string" && value in SYNC_TEMPLATES;
