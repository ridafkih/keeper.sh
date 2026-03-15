import { atom } from "jotai";
import { selectAtom } from "jotai/utils";
import type { CalendarDetail } from "@/types/api";

export const calendarDetailAtom = atom<CalendarDetail | null>(null);
export const calendarDetailLoadedAtom = atom<string | false>(false);
export const calendarDetailErrorAtom = atom<Error | null>(null);

export const calendarNameAtom = selectAtom(calendarDetailAtom, (detail) => detail?.name ?? "");
export const calendarProviderAtom = selectAtom(calendarDetailAtom, (detail) => detail?.provider ?? "");
export const calendarTypeAtom = selectAtom(calendarDetailAtom, (detail) => detail?.calendarType ?? "");
export const customEventNameAtom = selectAtom(calendarDetailAtom, (detail) => detail?.customEventName ?? "");

export const excludeEventNameAtom = selectAtom(calendarDetailAtom, (detail) => detail?.excludeEventName ?? false);
export const excludeEventDescriptionAtom = selectAtom(calendarDetailAtom, (detail) => detail?.excludeEventDescription ?? false);
export const excludeEventLocationAtom = selectAtom(calendarDetailAtom, (detail) => detail?.excludeEventLocation ?? false);
export const excludeAllDayEventsAtom = selectAtom(calendarDetailAtom, (detail) => detail?.excludeAllDayEvents ?? false);
export const excludeFocusTimeAtom = selectAtom(calendarDetailAtom, (detail) => detail?.excludeFocusTime ?? false);
export const excludeOutOfOfficeAtom = selectAtom(calendarDetailAtom, (detail) => detail?.excludeOutOfOffice ?? false);
export const excludeWorkingLocationAtom = selectAtom(calendarDetailAtom, (detail) => detail?.excludeWorkingLocation ?? false);

export type ExcludeField = keyof Pick<
  CalendarDetail,
  | "excludeAllDayEvents"
  | "excludeEventDescription"
  | "excludeEventLocation"
  | "excludeEventName"
  | "excludeFocusTime"
  | "excludeOutOfOffice"
  | "excludeWorkingLocation"
>;

export const excludeFieldAtoms = {
  excludeEventName: excludeEventNameAtom,
  excludeEventDescription: excludeEventDescriptionAtom,
  excludeEventLocation: excludeEventLocationAtom,
  excludeAllDayEvents: excludeAllDayEventsAtom,
  excludeFocusTime: excludeFocusTimeAtom,
  excludeOutOfOffice: excludeOutOfOfficeAtom,
  excludeWorkingLocation: excludeWorkingLocationAtom,
} as const;
