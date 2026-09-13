import X from "lucide-react/dist/esm/icons/x";
import { heading } from "@/components/ui/primitives/heading.styles";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import type { CalendarSource } from "@/types/api";
import type { BlankKind, SetupRule } from "../setup-draft";
import { DETAIL_LABELS } from "../detail-labels";
import { SentenceBlank, type BlankState } from "./sentence-blank";

export type SentenceSlot = BlankKind | "detail";

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
  const to = rule.toId ? calendarsById.get(rule.toId) : undefined;

  return (
    <div className="flex items-start gap-2">
      <p className={heading({ level: 3, className: "leading-relaxed" })}>
        Copy events from{" "}
        <SentenceBlank
          state={stateFor(Boolean(from), openSlot === "from")}
          label={from?.name ?? "a calendar"}
          icon={from && <ProviderIcon provider={from.provider} calendarType={from.calendarType} size={14} />}
          onClick={() => onOpen("from")}
        />
        {" "}to{" "}
        <SentenceBlank
          state={stateFor(Boolean(to), openSlot === "to")}
          label={to?.name ?? "another calendar"}
          icon={to && <ProviderIcon provider={to.provider} calendarType={to.calendarType} size={14} />}
          onClick={() => onOpen("to")}
        />
        {" "}and show them as{" "}
        <SentenceBlank
          state={stateFor(true, openSlot === "detail")}
          label={DETAIL_LABELS[rule.detail]}
          onClick={() => onOpen("detail")}
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
