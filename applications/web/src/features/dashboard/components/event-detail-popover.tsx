import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, LazyMotion } from "motion/react";
import * as m from "motion/react-m";
import MapPin from "lucide-react/dist/esm/icons/map-pin";
import { cn } from "@/utils/cn";
import { loadMotionFeatures } from "@/lib/motion-features";
import { ProviderIcon } from "@/components/ui/primitives/provider-icon";
import { formatDayHeader, formatTimeRange } from "@/lib/time";
import type { CalendarEvent } from "@/hooks/use-events";
import { EventText } from "./event-card";
import { EVENT_COLORS } from "./event-card.styles";

const PANEL_WIDTH = 320;
const FRAME_MARGIN = 8;

// Animation constants mirror NavigationMenuPopoverPanel so both morphs feel identical.
const SHADOW_HIDDEN = { boxShadow: "0 0 0 0 rgba(0,0,0,0)" } as const;
const SHADOW_VISIBLE = {
  boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)",
} as const;
const GHOST_ANIMATE = { height: 0, filter: "blur(0)", opacity: 0 };
const CONTENT_INITIAL = { height: 0, filter: "blur(0)", opacity: 0 };
const CONTENT_ANIMATE = { height: "fit-content" as const, filter: "blur(0)", opacity: 1 };
const CONTENT_EXIT = { height: 0, filter: "blur(4px)", opacity: 0 };
const DETAIL_MAX_HEIGHT = { maxHeight: "16rem" } as const;

interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface FrameRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface EventDetailSelection {
  event: CalendarEvent;
  /** Clicked card's rect, viewport coordinates. */
  anchor: AnchorRect;
  /** Bounds the panel is nudged to stay within. */
  frame: FrameRect;
}

interface EventDetailPopoverProps {
  selection: EventDetailSelection | null;
  onClose: () => void;
}

export function EventDetailPopover({ selection, onClose }: EventDetailPopoverProps) {
  const lastEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (selection) lastEventIdRef.current = selection.event.id;
  }, [selection]);

  // Portals can't render during SSR; the panel only ever opens from a client click.
  if (typeof document === "undefined") return null;

  const restoreFocus = () => {
    const id = lastEventIdRef.current;
    if (!id) return;
    document.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`)?.focus();
  };

  return createPortal(
    <LazyMotion features={loadMotionFeatures}>
      <AnimatePresence onExitComplete={restoreFocus}>
        {selection && <EventDetailPanel selection={selection} onClose={onClose} />}
      </AnimatePresence>
    </LazyMotion>,
    document.body,
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

interface EventDetailPanelProps {
  selection: EventDetailSelection;
  onClose: () => void;
}

function EventDetailPanel({ selection, onClose }: EventDetailPanelProps) {
  const { event, anchor, frame } = selection;
  const panelRef = useRef<HTMLDivElement>(null);
  const [detailHeight, setDetailHeight] = useState(0);

  // Measured via callback ref: the final box is only known once the detail content lays out.
  const measureDetail = useCallback((node: HTMLDivElement | null) => {
    if (node) setDetailHeight(node.offsetHeight);
  }, []);

  const maxLeft = Math.max(frame.right - PANEL_WIDTH - FRAME_MARGIN, frame.left + FRAME_MARGIN);
  const maxTop = Math.max(frame.bottom - detailHeight - FRAME_MARGIN, frame.top + FRAME_MARGIN);
  const nudge = {
    x: clamp(anchor.left, frame.left + FRAME_MARGIN, maxLeft) - anchor.left,
    y: clamp(anchor.top, frame.top + FRAME_MARGIN, maxTop) - anchor.top,
  };

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") onClose();
    };
    const onPointerDown = (pointerEvent: PointerEvent) => {
      if (
        panelRef.current
        && pointerEvent.target instanceof Node
        && !panelRef.current.contains(pointerEvent.target)
      ) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  const title = event.title ?? event.calendarName;

  return (
    <m.div
      className="pointer-events-none fixed z-50"
      style={{ top: anchor.top, left: anchor.left }}
      initial={{ x: 0, y: 0 }}
      animate={{ x: nudge.x, y: nudge.y }}
      exit={{ x: 0, y: 0 }}
    >
      <m.div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "pointer-events-auto overflow-hidden rounded-lg bg-(--event-surface) ring-1 ring-background focus-visible:outline-none",
          EVENT_COLORS.blue,
        )}
        initial={{ ...SHADOW_HIDDEN, width: anchor.width }}
        animate={{ ...SHADOW_VISIBLE, width: PANEL_WIDTH }}
        exit={{ ...SHADOW_HIDDEN, width: anchor.width }}
      >
        <m.div
          className="flex flex-col justify-end"
          initial={{ height: anchor.height, filter: "blur(4px)", opacity: 1 }}
          animate={GHOST_ANIMATE}
          exit={{ height: anchor.height, filter: "blur(0)", opacity: 1 }}
        >
          {/* Pixel-matches the card at t=0 so the panel appears to grow out of it. */}
          <div
            className="relative flex flex-col py-1 pr-2 pl-3 before:absolute before:inset-y-1 before:left-1 before:w-0.5 before:rounded-full before:bg-(--event-accent)"
            style={{ width: anchor.width, height: anchor.height }}
          >
            <EventText size="xs" muted className="truncate tabular-nums">
              {formatTimeRange(event.startTime, event.endTime)}
            </EventText>
            <EventText size="sm" className="truncate font-semibold">
              {title}
            </EventText>
          </div>
        </m.div>
        <m.div
          className="overflow-hidden"
          initial={CONTENT_INITIAL}
          animate={CONTENT_ANIMATE}
          exit={CONTENT_EXIT}
        >
          <div ref={measureDetail} className="overflow-y-auto" style={{ ...DETAIL_MAX_HEIGHT, width: PANEL_WIDTH }}>
            <div className="relative flex flex-col gap-1.5 py-3 pr-4 pl-5 before:absolute before:inset-y-3 before:left-2 before:w-0.5 before:rounded-full before:bg-(--event-accent)">
              <EventText size="sm" className="font-semibold">
                {title}
              </EventText>
              <EventText size="xs" muted className="tabular-nums">
                {formatDayHeader(event.startTime)} · {formatTimeRange(event.startTime, event.endTime)}
              </EventText>
              <div className="flex items-center gap-1.5">
                <ProviderIcon provider={event.calendarProvider} size={13} />
                <EventText as="span" size="xs" muted className="truncate">
                  {event.calendarName}
                </EventText>
              </div>
              {event.location && (
                <div className="flex items-start gap-1.5">
                  <MapPin size={13} className="mt-0.5 shrink-0 text-(--event-ink)/70" />
                  <EventText as="span" size="xs" muted>
                    {event.location}
                  </EventText>
                </div>
              )}
              {event.description && (
                <EventText size="xs" muted className="whitespace-pre-line">
                  {event.description}
                </EventText>
              )}
            </div>
          </div>
        </m.div>
      </m.div>
    </m.div>
  );
}
