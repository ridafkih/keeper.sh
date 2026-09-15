import { atom } from "jotai";
import { selectAtom } from "jotai/utils";
import type { CalendarDetail } from "@/types/api";

export const calendarDetailAtom = atom<CalendarDetail | null>(null);
export const calendarDetailLoadedAtom = atom<string | false>(false);
export const calendarDetailErrorAtom = atom<Error | null>(null);

export const calendarNameAtom = selectAtom(calendarDetailAtom, (detail) => detail?.name ?? "");
export const calendarProviderAtom = selectAtom(calendarDetailAtom, (detail) => detail?.provider ?? "");
export const calendarTypeAtom = selectAtom(calendarDetailAtom, (detail) => detail?.calendarType ?? "");
export const treatFullDayTimedEventsAsAllDayAtom = selectAtom(calendarDetailAtom, (detail) => detail?.treatFullDayTimedEventsAsAllDay ?? false);
export const calendarProviderMissingSinceAtom = selectAtom(calendarDetailAtom, (detail) => detail?.providerMissingSince ?? null);
