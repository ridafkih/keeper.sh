import { Fragment } from "react";
import X from "lucide-react/dist/esm/icons/x";
import { heading } from "@/components/ui/primitives/heading.styles";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import type { CalendarSource } from "@/types/api";
import type { SetupRule } from "../setup-draft";
import { DETAIL_LABELS } from "../detail-labels";
import { sameSlot, type SentenceSlot } from "../sentence-slot";
import { SentenceBlank, type BlankState } from "./sentence-blank";

interface SetupSentenceProps {
  rule: SetupRule;
  calendarsById: ReadonlyMap<string, CalendarSource>;
  openSlot: SentenceSlot | null;
  onOpen: (slot: SentenceSlot) => void;
  onRemove?: () => void;
}

const stateFor = (filled: boolean, open: boolean): BlankState => {
  if (open) return "open";
  return filled ? "filled" : "empty";
};

export function SetupSentence({ rule, calendarsById, openSlot, onOpen, onRemove }: SetupSentenceProps) {
  const from = rule.fromId ? calendarsById.get(rule.fromId) : undefined;
  const destinations = rule.toIds.map((id) => calendarsById.get(id)).filter((calendar) => calendar !== undefined);
  const isOpen = (slot: SentenceSlot) => openSlot !== null && sameSlot(openSlot, slot);
  const addSlot: SentenceSlot = { index: destinations.length, kind: "to" };

  return (
    <div className="flex items-start gap-2">
      <p className={heading({ level: 3, className: "leading-relaxed" })}>
        Copy events from{" "}
        <SentenceBlank
          state={stateFor(Boolean(from), isOpen({ kind: "from" }))}
          label={from?.name ?? "a calendar"}
          icon={from && <ProviderIcon provider={from.provider} calendarType={from.calendarType} size={14} />}
          onClick={() => onOpen({ kind: "from" })}
        />
        {" "}to{" "}
        {destinations.length === 0 && (
          <SentenceBlank
            state={stateFor(false, isOpen(addSlot))}
            label="another calendar"
            onClick={() => onOpen(addSlot)}
          />
        )}
        {destinations.map((calendar, index) => (
          <Fragment key={calendar.id}>
            {index > 0 && ", "}
            <SentenceBlank
              state={stateFor(true, isOpen({ index, kind: "to" }))}
              label={calendar.name}
              icon={<ProviderIcon provider={calendar.provider} calendarType={calendar.calendarType} size={14} />}
              onClick={() => onOpen({ index, kind: "to" })}
            />
          </Fragment>
        ))}
        {destinations.length > 0 && (
          <>
            {" "}
            <SentenceBlank
              state={stateFor(false, isOpen(addSlot))}
              ariaLabel="Add another destination"
              onClick={() => onOpen(addSlot)}
            />
          </>
        )}
        {" "}and show them as{" "}
        <SentenceBlank
          state={stateFor(true, isOpen({ kind: "detail" }))}
          label={DETAIL_LABELS[rule.detail]}
          onClick={() => onOpen({ kind: "detail" })}
        />
        .
      </p>
      {onRemove && (
        <button
          type="button"
          aria-label="Remove rule"
          onClick={onRemove}
          className="mt-1.5 shrink-0 rounded-lg p-1 text-foreground-muted hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
