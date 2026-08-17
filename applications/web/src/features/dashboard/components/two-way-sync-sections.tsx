import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useAtomValue, useStore } from "jotai";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { DashboardSection } from "@/components/ui/primitives/dashboard-heading";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { Text } from "@/components/ui/primitives/text";
import { TextLink } from "@/components/ui/primitives/text-link";
import { Button } from "@/components/ui/primitives/button";
import type { ButtonProps } from "@/components/ui/primitives/button";
import { PremiumFeatureGate } from "@/components/ui/primitives/upgrade-hint";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalTitle,
} from "@/components/ui/primitives/modal";
import {
  NavigationMenu,
  NavigationMenuCheckboxItem,
  NavigationMenuItemLabel,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { apiFetch } from "@/lib/fetcher";
import { serializedCall } from "@/lib/serialized-mutate";
import { canPush } from "@/utils/calendars";
import { useEntitlements } from "@/hooks/use-entitlements";
import type { CalendarSource } from "@/types/api";
import {
  resolveDeleteConfirmationAnswers,
  resolveModeSelection,
} from "@/lib/write-back-answers";
import type { DeleteConfirmationAnswer } from "@/lib/write-back-answers";
import {
  resolveUnwritableSourceCopy,
  resolveWriteBackStateCopy,
  supportsWriteBack,
} from "@/lib/write-back-copy";
import { calendarDetailAtom, calendarNameAtom } from "@/state/calendar-detail";
import type { WriteBackMode, WriteBackStatus } from "@/state/destination-ids";
import {
  destinationIdsAtom,
  selectSiblingDestinationCount,
  selectWriteBackMode,
  selectWriteBackState,
  writeBackModesAtom,
  writeBackStatesAtom,
} from "@/state/destination-ids";

/*
 * One escalating list rather than two controls. Every line is a single decision the user can
 * read in full, and each is disabled until the one above it is given, because none of them
 * means anything on its own: deleting originals is meaningless without write-back, and
 * moving a meeting is meaningless without permission to touch meetings at all.
 *
 * The two questions underneath stay distinct — the first two lines are which verbs are
 * allowed, the last three are who they may be aimed at — so "delete" and "somebody else's
 * event" remain separate answers rather than one combined level.
 */
const REACH_ORDER = ["own_events", "my_meetings", "my_meetings_notifying", "any_event"];

const reachAtLeast = (reach: string, level: string): boolean =>
  REACH_ORDER.indexOf(reach) >= REACH_ORDER.indexOf(level);

const reachFor = (level: string, checked: boolean): string => {
  if (checked) {
    return level;
  }
  return REACH_ORDER[REACH_ORDER.indexOf(level) - 1] ?? "own_events";
};

function WriteBackPermissions({
  locked,
  mode,
  onModeChange,
  onReachChange,
  reach,
  writable,
}: {
  locked: boolean;
  mode: WriteBackMode;
  onModeChange: (mode: WriteBackMode) => void;
  onReachChange: (reach: string) => void;
  reach: string;
  writable: boolean;
}) {
  const twoWay = mode !== "off";
  const meetings = reachAtLeast(reach, "my_meetings");
  const moving = reachAtLeast(reach, "my_meetings_notifying");

  return (
    <PremiumFeatureGate hint="Two-way sync is a Pro feature." locked={locked}>
      <NavigationMenu>
        <NavigationMenuCheckboxItem
          checked={twoWay}
          disabled={!writable}
          onCheckedChange={(checked) => { onModeChange(checked ? "edits" : "off"); }}
        >
          <NavigationMenuItemLabel>Two-Way Sync Copy Changes</NavigationMenuItemLabel>
        </NavigationMenuCheckboxItem>
        <NavigationMenuCheckboxItem
          checked={mode === "edits_and_deletes"}
          disabled={!writable || !twoWay}
          onCheckedChange={(checked) => {
            onModeChange(checked ? "edits_and_deletes" : "edits");
          }}
        >
          <NavigationMenuItemLabel>Two-Way Sync Deleted Events</NavigationMenuItemLabel>
        </NavigationMenuCheckboxItem>
        <NavigationMenuCheckboxItem
          checked={meetings}
          disabled={!writable || !twoWay}
          onCheckedChange={(checked) => { onReachChange(reachFor("my_meetings", checked)); }}
        >
          <NavigationMenuItemLabel>Two-Way Sync My Meetings</NavigationMenuItemLabel>
        </NavigationMenuCheckboxItem>
        <NavigationMenuCheckboxItem
          checked={moving}
          disabled={!writable || !meetings}
          onCheckedChange={(checked) => {
            onReachChange(reachFor("my_meetings_notifying", checked));
          }}
        >
          <NavigationMenuItemLabel>Two-Way Sync Moving & Cancelling</NavigationMenuItemLabel>
        </NavigationMenuCheckboxItem>
        <NavigationMenuCheckboxItem
          checked={reachAtLeast(reach, "any_event")}
          disabled={!writable || !moving}
          onCheckedChange={(checked) => { onReachChange(reachFor("any_event", checked)); }}
        >
          <NavigationMenuItemLabel>Two-Way Sync Changes to Others' Events</NavigationMenuItemLabel>
        </NavigationMenuCheckboxItem>
      </NavigationMenu>
    </PremiumFeatureGate>
  );
}


function WriteBackModeControl({
  calendarId,
  calendarType,
  destinationId,
  destinationName,
  provider,
}: {
  calendarId: string;
  calendarType: string;
  destinationId: string;
  destinationName: string;
  provider: string;
}) {
  const store = useStore();
  const { mutate } = useSWRConfig();
  const { data: entitlements } = useEntitlements();
  const modeAtom = useMemo(() => selectWriteBackMode(destinationId), [destinationId]);
  const mode = useAtomValue(modeAtom);
  const sourceName = useAtomValue(calendarNameAtom);
  const stateAtom = useMemo(() => selectWriteBackState(destinationId), [destinationId]);
  const status = useAtomValue(stateAtom);
  const siblingCountAtom = useMemo(
    () => selectSiblingDestinationCount(destinationId),
    [destinationId],
  );
  const siblingCount = useAtomValue(siblingCountAtom);
  const [pendingDeletionConsent, setPendingDeletionConsent] = useState(false);
  const locked = Boolean(entitlements && !entitlements.canUseTwoWaySync);
  const calendarDetail = useAtomValue(calendarDetailAtom);
  const writableSource = supportsWriteBack(calendarDetail);

  const applyMode = (nextMode: WriteBackMode) => {
    const selection = resolveModeSelection({
      locked,
      nextMode,
      selectedMode: mode,
      status,
      writableSource,
    });
    if (selection === "ignore") {
      return;
    }
    if (selection === "confirm_deletions") {
      setPendingDeletionConsent(true);
      return;
    }
    commitMode(nextMode);
  };

  /*
   * The pass asked a question and paused rather than deleting anything. Answering it is
   * the only way through: re-picking the mode the pair already carries is a no-op, so the
   * held deletions would otherwise be unreachable.
   */
  const resolveDeleteConfirmation = (decision: DeleteConfirmationAnswer) => {
    track(ANALYTICS_EVENTS.write_back_mode_changed, {
      deletions: decision !== "decline",
      mode,
    });
    const swrKey = `/api/sources/${calendarId}/destinations`;
    serializedCall(swrKey, () =>
      apiFetch(`${swrKey}/${destinationId}/delete-confirmation`, {
        body: JSON.stringify({ decision }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }).finally(() => {
        void mutate(swrKey);
      }));
  };

  const commitReach = (writeBackReach: string) => {
    const swrKey = `/api/sources/${calendarId}/destinations`;
    serializedCall(swrKey, () =>
      apiFetch(`${swrKey}/${destinationId}/write-back-reach`, {
        body: JSON.stringify({ writeBackReach }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }).finally(() => {
        void mutate(swrKey);
      }));
  };

  const commitMode = (nextMode: WriteBackMode) => {
    track(ANALYTICS_EVENTS.write_back_mode_changed, {
      deletions: nextMode === "edits_and_deletes",
      mode: nextMode,
    });

    const previousModes = store.get(writeBackModesAtom);
    store.set(writeBackModesAtom, { ...previousModes, [destinationId]: nextMode });

    const swrKey = `/api/sources/${calendarId}/destinations`;
    serializedCall(swrKey, () =>
      apiFetch(`${swrKey}/${destinationId}`, {
        body: JSON.stringify({ writeBackMode: nextMode }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }).catch(() => {
        store.set(writeBackModesAtom, previousModes);
      }).finally(() => {
        void mutate(swrKey);
      }));
  };

  return (
    <>
      <DashboardSection
        level={3}
        icon={<ProviderIcon provider={provider} calendarType={calendarType} size={14} />}
        title={destinationName}
      />
      <WriteBackPermissions
        locked={locked}
        mode={mode}
        onModeChange={applyMode}
        onReachChange={commitReach}
        reach={status?.writeBackReach ?? "own_events"}
        writable={writableSource}
      />
      {!writableSource && (
        <Text size="xs">
          {resolveUnwritableSourceCopy(calendarDetail)}
        </Text>
      )}
      <WriteBackStatusLine
        destinationName={destinationName}
        onResolveDeleteConfirmation={resolveDeleteConfirmation}
        sourceName={sourceName || "this calendar"}
        status={status}
      />
      {pendingDeletionConsent && (
        <DeletionConsentModal
          destinationName={destinationName}
          onCancel={() => { setPendingDeletionConsent(false); }}
          onConfirm={() => {
            setPendingDeletionConsent(false);
            commitMode("edits_and_deletes");
          }}
          siblingCount={siblingCount}
          sourceName={sourceName || "this calendar"}
        />
      )}
    </>
  );
}


const ANSWER_LABELS: Record<DeleteConfirmationAnswer, (sourceName: string) => string> = {
  apply: (sourceName) => `Delete the originals on ${sourceName}`,
  apply_empty_destination: (sourceName) =>
    `I emptied it myself — delete the originals on ${sourceName}`,
  decline: () => "Put the copies back",
};

function WriteBackStatusLine({
  destinationName,
  onResolveDeleteConfirmation,
  sourceName,
  status,
}: {
  destinationName: string;
  onResolveDeleteConfirmation: (decision: DeleteConfirmationAnswer) => void;
  sourceName: string;
  status: WriteBackStatus | null;
}) {
  if (!status || status.state === "ok") {
    return null;
  }
  const template = resolveWriteBackStateCopy(
    status,
    `Two-way sync to ${destinationName} is paused.`,
  );
  const answers = resolveDeleteConfirmationAnswers(status);

  return (
    <div className="flex flex-col gap-2">
      <Text size="xs" className="text-destructive">
        {template.split("{destination}").join(destinationName)
          .split("{source}").join(sourceName)}
      </Text>
      {answers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {answers.map((answer) => (
            <Button
              key={answer}
              type="button"
              size="compact"
              variant={resolveDeleteAnswerVariant(answer)}
              onClick={() => { onResolveDeleteConfirmation(answer); }}
            >
              {ANSWER_LABELS[answer](sourceName)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function DeletionConsentModal({
  destinationName,
  onCancel,
  onConfirm,
  siblingCount,
  sourceName,
}: {
  destinationName: string;
  onCancel: () => void;
  onConfirm: () => void;
  siblingCount: number;
  sourceName: string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Modal open onOpenChange={(next) => { if (!next) onCancel(); }}>
      <ModalContent>
        <ModalTitle>Propagate deletions?</ModalTitle>
        <ModalDescription>
          {`Deleting a copy on ${destinationName} will permanently delete the original on `}
          {sourceName}
          {siblingCount > 0
            ? ` — and remove it from the ${siblingCount} other calendar${siblingCount === 1 ? "" : "s"} it is copied to.`
            : "."}
          {" Keeper.sh never deletes or moves an original that other people are invited to,"}
          {" and keeps a record of what it did delete — title, time, place and description —"}
          {" for 30 days."}
        </ModalDescription>
        <TextLink align="left" size="xs" to="/dashboard/deleted-events">
          See the record of deleted events
        </TextLink>
        <label className="flex items-start gap-2 text-xs">
          <input
            checked={acknowledged}
            onChange={(event) => { setAcknowledged(event.target.checked); }}
            type="checkbox"
          />
          <span>
            {`I understand deleting a copy deletes the real event on ${sourceName}.`}
          </span>
        </label>
        <ModalFooter>
          <Button disabled={!acknowledged} onClick={onConfirm}>
            Turn on deletion propagation
          </Button>
          <Button onClick={onCancel} variant="ghost">Cancel</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

const resolveDeleteAnswerVariant = (
  answer: DeleteConfirmationAnswer,
): ButtonProps["variant"] => {
  switch (answer) {
    case "decline":
      return "border";
    default:
      return "destructive";
  }
};

export function TwoWaySyncSections({ calendarId }: { calendarId: string }) {
  const { data: allCalendars } = useSWR<CalendarSource[]>("/api/sources");
  const { data } = useSWR<{
    destinationIds?: string[];
    writeBackModes?: Record<string, WriteBackMode>;
    writeBackStates?: Record<string, WriteBackStatus>;
  }>(`/api/sources/${calendarId}/destinations`);
  const store = useStore();

  useEffect(() => {
    store.set(destinationIdsAtom, new Set(data?.destinationIds));
    store.set(writeBackModesAtom, data?.writeBackModes ?? {});
    store.set(writeBackStatesAtom, data?.writeBackStates ?? {});
  }, [calendarId, data, store]);

  const destinationIds = useAtomValue(destinationIdsAtom);
  const connected = useMemo(
    () => (allCalendars ?? []).filter((calendar) =>
      canPush(calendar) && calendar.id !== calendarId && destinationIds.has(calendar.id)),
    [allCalendars, calendarId, destinationIds],
  );

  if (connected.length === 0) {
    return (
      <Text size="sm">
        This calendar is not sending events anywhere yet. Connect a calendar first.
      </Text>
    );
  }

  return (
    <>
      {connected.map((calendar) => (
        <WriteBackModeControl
          key={calendar.id}
          calendarId={calendarId}
          calendarType={calendar.calendarType}
          destinationId={calendar.id}
          destinationName={calendar.name}
          provider={calendar.provider}
        />
      ))}
    </>
  );
}
