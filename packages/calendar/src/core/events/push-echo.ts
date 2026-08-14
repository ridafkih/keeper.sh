import type { EditableEventContentSnapshot } from "./content-hash";
import type { PushEchoDivergedLengths, PushEchoFieldDivergence } from "../types";

/*
 * One observation of an event's editable state, built by the same conversion a
 * provider uses when reading the calendar back. Field values stay in memory —
 * only boolean divergence flags and UTF-16 lengths ever leave this module.
 * Per-field value fingerprints are deliberately deferred pending the
 * keyed-digest recommendation; they would slot in here as an extension of this
 * shape.
 */
interface PushEchoObservation {
  content: EditableEventContentSnapshot;
  endTime: Date;
  startTime: Date;
}

const isSameSerializedSecond = (first: Date, second: Date): boolean =>
  Math.trunc(first.getTime() / 1000) === Math.trunc(second.getTime() / 1000);

const divergedLengths = (
  field: "description" | "location" | "summary",
  sent: string,
  echo: string,
): PushEchoDivergedLengths => {
  if (sent === echo) {
    return {};
  }
  return { [field]: { echo: echo.length, sent: sent.length } };
};

const collectDivergedLengths = (
  sent: PushEchoObservation,
  echo: PushEchoObservation,
): PushEchoDivergedLengths => ({
  ...divergedLengths("description", sent.content.description, echo.content.description),
  ...divergedLengths("location", sent.content.location, echo.content.location),
  ...divergedLengths("summary", sent.content.summary, echo.content.summary),
});

const comparePushEchoObservations = (
  sent: PushEchoObservation,
  echo: PushEchoObservation,
): PushEchoFieldDivergence => ({
  allDay: sent.content.isAllDay !== echo.content.isAllDay,
  description: sent.content.description !== echo.content.description,
  end: !isSameSerializedSecond(sent.endTime, echo.endTime),
  lengths: collectDivergedLengths(sent, echo),
  location: sent.content.location !== echo.content.location,
  start: !isSameSerializedSecond(sent.startTime, echo.startTime),
  summary: sent.content.summary !== echo.content.summary,
});

const hasPushEchoDivergence = (divergence: PushEchoFieldDivergence): boolean =>
  divergence.allDay
  || divergence.description
  || divergence.end
  || divergence.location
  || divergence.start
  || divergence.summary;

export { comparePushEchoObservations, hasPushEchoDivergence };
export type { PushEchoObservation };
