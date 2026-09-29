import { useLayoutEffect, useRef, useState, type PropsWithChildren } from "react";
import { AnimatePresence, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import Check from "lucide-react/dist/esm/icons/check";
import Funnel from "lucide-react/dist/esm/icons/funnel";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert";
import X from "lucide-react/dist/esm/icons/x";
import type { SyncActivitySummary, SyncDetail, SyncRunRecord } from "@keeper.sh/data-schemas";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { SegmentedControl } from "@/components/ui/primitives/segmented-control";
import { Text } from "@/components/ui/primitives/text";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuEmptyItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
  NavigationMenuLinkItem,
} from "@/components/ui/composites/navigation-menu/navigation-menu-items";
import { NavigationMenuPopover } from "@/components/ui/composites/navigation-menu/navigation-menu-popover";
import { usePopover } from "@/components/ui/composites/navigation-menu/navigation-menu.contexts";
import { loadMotionFeatures } from "@/lib/motion-features";
import type { CalendarSource } from "@/types/api";
import { cn } from "@/utils/cn";
import {
  describeActivitySummary,
  formatActivityClock,
  listNames,
  formatActivityDay,
  groupActivity,
  type ActivityDay,
  type ActivityFilter,
  type ActivityKind,
} from "../sync-activity";
import { calendarName, describeChange } from "../syncs";
import { useSyncActivity } from "../use-syncs";

const KIND_OPTIONS: { label: string; value: ActivityKind }[] = [
  { label: "Everything", value: "all" },
  { label: "Sync Runs", value: "runs" },
  { label: "Your Changes", value: "changes" },
];

const REASON_COLORS = ["bg-emerald-400", "bg-blue-400", "bg-violet-400", "bg-pink-400", "bg-amber-400"];

const PROBLEM_TEXT = { disabled: ["is turned off", "are turned off"], failing: ["keeps failing, retrying", "keep failing, retrying"], reauth: ["needs reconnecting", "need reconnecting"] } as const;

type SourcesById = ReadonlyMap<string, CalendarSource>;

interface SyncActivityProps {
  sync: SyncDetail;
  calendars: CalendarSource[];
}

export function SyncActivity({ sync, calendars }: SyncActivityProps) {
  const calendarsById: SourcesById = new Map(calendars.map((calendar) => [calendar.id, calendar] as const));
  const { data, entries, hasMore, isValidating, setSize, size, summary } = useSyncActivity(sync.id);
  const [filter, setFilter] = useState<ActivityFilter>({ calendarId: null, kind: "all" });

  const destinationIds = sync.destinations.map((destination) => destination.calendarId);
  const problems = sync.destinations.filter((destination) => destination.problem !== null);
  const waitingOn = problems
    .filter((destination) => destination.problem === "reauth")
    .map((destination) => calendarName(calendarsById, destination.calendarId));
  const days = groupActivity(entries, filter);
  const pickCalendar = (calendarId: string | null) => setFilter((current) => ({ ...current, calendarId }));
  const pickFromLog = destinationIds.length > 1 ? pickCalendar : undefined;

  return (
    <>
      {(problems.length > 0 || summary) && (
        <div className="flex flex-col gap-4 pt-1.5">
          {problems.length > 0 && (
            <NavigationMenu variant="attention">
              {reconnectRows(problems, calendarsById).map((row) => (
                <NavigationMenuLinkItem key={row.key} to={row.to}>
                  <NavigationMenuItemIcon><TriangleAlert size={15} /></NavigationMenuItemIcon>
                  <NavigationMenuItemLabel>{row.label}</NavigationMenuItemLabel>
                  {row.to && <NavigationMenuItemTrailing><Text size="sm" tone="attention" className="hidden sm:block">Reconnect</Text></NavigationMenuItemTrailing>}
                </NavigationMenuLinkItem>
              ))}
            </NavigationMenu>
          )}
          {summary && (
            <ActivityDigest
              summary={summary}
              calendarNames={destinationIds.map((calendarId) => calendarName(calendarsById, calendarId))}
              waitingOn={waitingOn}
            />
          )}
        </div>
      )}
      {/* The day headings stick at top-12, right under this bar, so it keeps to one row. */}
      <div className="relative z-[4] -mx-0.5 flex flex-wrap has-[[data-popover-open]]:z-20 items-center justify-between gap-x-3 gap-y-2 bg-background px-0.5 pt-2.5 pb-2 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-3 after:bg-linear-to-b after:from-background after:to-transparent lg:sticky lg:top-0 lg:-mx-(--sidebar-pad-x) lg:h-12 lg:flex-nowrap lg:px-[calc(var(--sidebar-pad-x)+0.125rem)] lg:pt-2">
        <div className="shrink-0">
          <SegmentedControl
            label="Show"
            options={KIND_OPTIONS}
            value={filter.kind}
            onChange={(kind) => setFilter((current) => ({ ...current, kind }))}
          />
        </div>
        {destinationIds.length > 1 && (
          <CalendarFilterMenu
            calendarIds={destinationIds}
            calendarsById={calendarsById}
            problems={new Set(problems.map((destination) => destination.calendarId))}
            value={filter.calendarId}
            disabled={filter.kind === "changes"}
            onChange={pickCalendar}
          />
        )}
      </div>
      {data && entries.length === 0 && !hasMore && (
        <NavigationMenu>
          <NavigationMenuEmptyItem>Changes and sync runs show up here</NavigationMenuEmptyItem>
        </NavigationMenu>
      )}
      {entries.length > 0 && days.length === 0 && (
        <Text size="sm" tone="muted" align="center" className="py-8">
          {hasMore ? "Nothing matches in what's loaded so far." : "Nothing matches these filters."}
        </Text>
      )}
      {days.map((day) => <ActivityDaySection key={day.key} day={day} calendarsById={calendarsById} onPickCalendar={pickFromLog} />)}
      {hasMore && (
        <div className="pt-3">
          <NavigationMenu>
            <NavigationMenuButtonItem disabled={isValidating && size > 1} onClick={() => { void setSize(size + 1); }}>
              <NavigationMenuItemLabel>{isValidating && size > 1 ? "Loading…" : "Show Older"}</NavigationMenuItemLabel>
            </NavigationMenuButtonItem>
          </NavigationMenu>
        </div>
      )}
    </>
  );
}

interface ProblemRow {
  key: string;
  label: string;
  to?: string;
}

// Calendars sharing an account reconnect together, so they share one row.
const reconnectRows = (problems: SyncDetail["destinations"], calendarsById: SourcesById): ProblemRow[] => {
  const groups = new Map<string, { names: string[]; problem: keyof typeof PROBLEM_TEXT; to?: string }>();
  for (const destination of problems) {
    if (!destination.problem) continue;
    const accountId = calendarsById.get(destination.calendarId)?.accountId;
    const key = destination.problem === "reauth" && accountId ? `reauth:${accountId}` : `${destination.problem}:${destination.calendarId}`;
    const group = groups.get(key) ?? {
      names: [],
      problem: destination.problem,
      to: destination.problem === "reauth" && accountId ? `/dashboard/accounts/${accountId}/reconnect` : undefined,
    };
    group.names.push(calendarName(calendarsById, destination.calendarId));
    groups.set(key, group);
  }
  return [...groups].map(([key, group]) => ({
    key,
    label: `${listNames(group.names)} ${PROBLEM_TEXT[group.problem][group.names.length === 1 ? 0 : 1]}`,
    to: group.to,
  }));
};

function ActivityDigest({ summary, calendarNames, waitingOn }: { summary: SyncActivitySummary; calendarNames: string[]; waitingOn: string[] }) {
  const sentence = describeActivitySummary(summary, calendarNames, waitingOn);
  const named = summary.skippedBy.reduce((total, reason) => total + reason.count, 0);
  const reasons = [
    ...summary.skippedBy.map((reason, index) => ({ className: REASON_COLORS[index % REASON_COLORS.length], count: reason.count, key: reason.ruleId, name: reason.name })),
    ...(summary.skipped > named ? [{ className: "bg-foreground-disabled", count: summary.skipped - named, key: "other", name: "Other" }] : []),
  ];

  return (
    <div className="flex flex-col gap-3.5 rounded-[1.25rem] border border-border-elevated bg-background-elevated px-4 pt-3.5 pb-4">
      <p className="text-lg leading-snug font-medium tracking-tight text-pretty text-foreground">
        <span className="text-foreground-muted">{sentence.period}</span> {sentence.headline}
        {sentence.detail && <span className="text-foreground-muted"> {sentence.detail}</span>}
      </p>
      {reasons.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <Text size="xs" tone="muted">Why events are skipped</Text>
            <Text size="xs" tone="muted" className="tabular-nums">{summary.skipped} events</Text>
          </div>
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {reasons.map((reason) => <span key={reason.key} className={reason.className} style={{ flexGrow: reason.count }} />)}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {reasons.map((reason) => (
              <Text key={reason.key} size="xs" tone="muted" className="flex items-center gap-1.5">
                <span aria-hidden className={cn("size-2 rounded-xs", reason.className)} />
                {reason.name}
                <span className="font-medium text-foreground tabular-nums">{reason.count}</span>
              </Text>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityDaySection({ day, calendarsById, onPickCalendar }: { day: ActivityDay; calendarsById: SourcesById; onPickCalendar?: (calendarId: string) => void }) {
  const totals = [day.added > 0 && `+${day.added} new`, day.removed > 0 && `−${day.removed} removed`].filter(Boolean).join(" · ");

  return (
    <section className="flex flex-col">
      <div className="z-[3] flex items-baseline justify-between gap-2 bg-background px-0.5 pt-5 pb-2 lg:sticky lg:top-12">
        <h3 className="text-base font-medium tracking-tight text-foreground">{formatActivityDay(day.date)}</h3>
        {totals && <Text size="xs" tone="muted" className="tabular-nums">{totals}</Text>}
      </div>
      <ol className="relative flex flex-col pl-7 before:absolute before:inset-y-3 before:left-[0.6875rem] before:w-px before:bg-interactive-border">
        {day.items.map((item) => (
          <li key={item.id} className="relative flex items-start gap-3 py-2">
            {item.kind === "change" ? (
              <>
                <TimelineNode className="bg-background-elevated text-foreground"><Pencil size={11} /></TimelineNode>
                <TimelineTime date={item.at} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Text size="sm" tone="default">{describeChange(item.change, calendarsById)}</Text>
                  <Text size="xs" tone="muted">You changed the setup</Text>
                </div>
              </>
            ) : (
              <>
                <PassNode runs={item.runs} />
                <TimelineTime date={item.at} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {item.runs.map((run) => <RunRow key={run.destinationCalendarId} run={run} calendarsById={calendarsById} onPick={onPickCalendar} />)}
                </div>
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function TimelineNode({ className, children }: PropsWithChildren<{ className?: string }>) {
  return (
    <span aria-hidden className={cn("absolute top-2 -left-7 grid size-5.5 place-items-center rounded-full border border-interactive-border bg-background text-foreground-muted", className)}>
      {children}
    </span>
  );
}

function PassNode({ runs }: { runs: SyncRunRecord[] }) {
  if (runs.some((run) => run.failed > 0)) {
    return <TimelineNode className="border-attention-border bg-attention-background text-attention"><TriangleAlert size={11} /></TimelineNode>;
  }
  return <TimelineNode><RefreshCw size={11} /></TimelineNode>;
}

function TimelineTime({ date }: { date: Date }) {
  return <Text size="xs" tone="muted" className="w-14 shrink-0 pt-0.5 tabular-nums">{formatActivityClock(date)}</Text>;
}

function RunRow({ run, calendarsById, onPick }: { run: SyncRunRecord; calendarsById: SourcesById; onPick?: (calendarId: string) => void }) {
  const calendar = calendarsById.get(run.destinationCalendarId);
  const quiet = run.added === 0 && run.removed === 0 && run.failed === 0;
  const name = (
    <>
      {calendar && <ProviderIcon provider={calendar.provider} calendarType={calendar.calendarType} size={14} />}
      <span className="min-w-0 truncate">{calendarName(calendarsById, run.destinationCalendarId)}</span>
    </>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {onPick ? (
        <button
          type="button"
          title="Show only this calendar"
          onClick={() => onPick(run.destinationCalendarId)}
          className="group -mx-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 text-sm tracking-tight text-foreground hover:bg-background-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {name}
          <Funnel size={11} className="shrink-0 text-foreground-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      ) : (
        <Text size="sm" tone="default" className="flex min-w-0 items-center gap-1.5">{name}</Text>
      )}
      {run.added > 0 && <Delta className="bg-emerald-400/15">+{run.added} new</Delta>}
      {run.removed > 0 && <Delta className="bg-background-hover">−{run.removed} removed</Delta>}
      {run.failed > 0 && (
        <Delta className="bg-attention-background text-attention ring-1 ring-attention-border ring-inset">
          <TriangleAlert size={11} />{run.failed} failed
        </Delta>
      )}
      {quiet && <Text size="xs" tone="muted">Back to normal</Text>}
      {run.sharedDestination && <Text size="xs" tone="muted">· shared with other syncs</Text>}
    </div>
  );
}

function Delta({ className, children }: PropsWithChildren<{ className: string }>) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 text-xs tracking-tight whitespace-nowrap text-foreground tabular-nums", className)}>{children}</span>;
}

interface CalendarFilterMenuProps {
  calendarIds: string[];
  calendarsById: SourcesById;
  problems: ReadonlySet<string>;
  value: string | null;
  disabled: boolean;
  onChange: (calendarId: string | null) => void;
}

const EASE = [0.2, 0, 0, 1] as const;
const WIDTH_TRANSITION = { duration: 0.2, ease: EASE };
const POP_TRANSITION = { duration: 0.15, ease: EASE };
const INSTANT = { duration: 0 };
const POPPED_OUT = { opacity: 0, scale: 0.5 };
const POPPED_IN = { opacity: 1, scale: 1 };

// A track like the tabs beside it, holding the shared dropdown at its compact size. The track fits its name,
// the list opens wider so long names fit, and a picked calendar fills the segment and adds a clear button.
function CalendarFilterMenu({ calendarIds, calendarsById, problems, value, disabled, onChange }: CalendarFilterMenuProps) {
  const picked = value ? calendarsById.get(value) : undefined;
  const reduceMotion = useReducedMotion() ?? false;
  const pop = reduceMotion ? INSTANT : POP_TRANSITION;

  return (
    <LazyMotion features={loadMotionFeatures}>
      <AnimatedWidth className={cn("rounded-lg bg-background-hover p-0.5", disabled && "pointer-events-none opacity-40")}>
        <ul
          className={cn(
            "flex max-w-[15.75rem] min-w-0 items-center rounded-md shadow-xs transition-colors duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
            value ? "bg-foreground text-background" : "bg-background-elevated text-foreground",
          )}
        >
          <NavigationMenuPopover
            size="compact"
            disabled={disabled}
            className="min-w-0 flex-1"
            panelClassName="-inset-y-0.75 -right-0.75 w-[calc(16rem+0.375rem)] justify-items-end"
            triggerClassName={cn("bg-transparent hover:bg-transparent! [&>svg]:text-current [&>svg]:opacity-60", value && "pr-1")}
            trigger={(
              <>
                <AnimatePresence initial={false}>
                  {picked && (
                    <m.span key={picked.id} className="flex shrink-0" initial={POPPED_OUT} animate={POPPED_IN} transition={pop}>
                      <ProviderIcon provider={picked.provider} calendarType={picked.calendarType} size={12} />
                    </m.span>
                  )}
                </AnimatePresence>
                <span className="min-w-0 truncate text-sm font-medium tracking-tight">
                  {value ? calendarName(calendarsById, value) : "All Calendars"}
                </span>
              </>
            )}
          >
            <CalendarFilterOption picked={value === null} onPick={() => onChange(null)}>
              <NavigationMenuItemLabel>All Calendars</NavigationMenuItemLabel>
            </CalendarFilterOption>
            {calendarIds.map((calendarId) => {
              const calendar = calendarsById.get(calendarId);
              return (
                <CalendarFilterOption key={calendarId} picked={value === calendarId} onPick={() => onChange(calendarId)}>
                  {calendar && <ProviderIcon provider={calendar.provider} calendarType={calendar.calendarType} size={14} />}
                  <NavigationMenuItemLabel>{calendarName(calendarsById, calendarId)}</NavigationMenuItemLabel>
                  {problems.has(calendarId) && <Text size="xs" tone="attention" className="shrink-0">Needs attention</Text>}
                </CalendarFilterOption>
              );
            })}
          </NavigationMenuPopover>
          <AnimatePresence initial={false}>
            {value && (
              <m.li key="clear" className="flex shrink-0" initial={POPPED_OUT} animate={POPPED_IN} exit={POPPED_OUT} transition={pop}>
                <button
                  type="button"
                  aria-label="Show all calendars"
                  onClick={() => onChange(null)}
                  className="mr-1 grid size-4 place-items-center rounded-sm bg-current/15 hover:bg-current/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              </m.li>
            )}
          </AnimatePresence>
        </ul>
      </AnimatedWidth>
    </LazyMotion>
  );
}

// Width can't transition to auto, so this measures what its content wants and animates to that.
// It clips only while nothing inside has a popover out, since the list opens past its edges.
function AnimatedWidth({ className, children }: PropsWithChildren<{ className?: string }>) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const reduceMotion = useReducedMotion() ?? false;

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const measure = () => setWidth(inner.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  return (
    <m.div
      className={cn("box-content min-w-0 not-has-[[data-popover-open]]:overflow-clip", className)}
      initial={false}
      animate={width === null ? undefined : { width }}
      transition={reduceMotion ? INSTANT : WIDTH_TRANSITION}
    >
      <div ref={innerRef} className="w-max">{children}</div>
    </m.div>
  );
}

// The button only changes once the list has folded back into it, so the two never move at once.
function CalendarFilterOption({ picked, onPick, children }: PropsWithChildren<{ picked: boolean; onPick: () => void }>) {
  const { closeThen } = usePopover();
  return (
    <NavigationMenuButtonItem onClick={() => closeThen(onPick)}>
      {children}
      <NavigationMenuItemTrailing indicator={picked ? <Check size={15} className="shrink-0 text-foreground" /> : null} />
    </NavigationMenuButtonItem>
  );
}
