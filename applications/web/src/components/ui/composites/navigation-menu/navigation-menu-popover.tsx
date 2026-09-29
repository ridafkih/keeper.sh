import { use, useCallback, useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren, type ReactNode } from "react";
import { AnimatePresence, LazyMotion, useReducedMotion } from "motion/react";
import { loadMotionFeatures } from "@/lib/motion-features";
import * as m from "motion/react-m";
import ChevronsUpDown from "lucide-react/dist/esm/icons/chevrons-up-down";
import { cn } from "@/utils/cn";
import { useSetPopoverOverlay } from "@/hooks/use-popover-overlay";
import { resolveScrollParent } from "@/lib/scroll-parent";
import {
  InsidePopoverContext,
  ItemDisabledContext,
  MenuVariantContext,
  PopoverContext,
  usePopover,
} from "./navigation-menu.contexts";
import {
  navigationMenuItemIconStyle,
  navigationMenuItemStyle,
  navigationMenuStyle,
  type MenuItemSize,
} from "./navigation-menu.styles";

const POPOVER_INITIAL = { opacity: 1 } as const;
const SHADOW_HIDDEN = { boxShadow: "0 0 0 0 rgba(0,0,0,0)" } as const;
const SHADOW_VISIBLE = {
  boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)",
} as const;
const TRIGGER_INITIAL = { height: "fit-content" as const, filter: "blur(4px)", opacity: 1 };
const TRIGGER_ANIMATE = { height: 0, filter: "blur(0)", opacity: 0 };
const TRIGGER_EXIT = { height: "fit-content" as const, filter: "blur(0)", opacity: 1 };
const CONTENT_INITIAL = { height: 0, filter: "blur(0)", opacity: 0 };
const CONTENT_ANIMATE = { height: "fit-content" as const, filter: "blur(0)", opacity: 1 };
const CONTENT_EXIT = { height: 0, filter: "blur(4px)", opacity: 0 };
const POPOVER_CONTENT_STYLE = { maxHeight: "16rem" } as const;
const REVEAL_MARGIN_PX = 8;

interface PanelParts {
  anchor: HTMLElement;
  panel: HTMLElement;
  trigger: HTMLElement;
  content: HTMLElement;
  list: HTMLElement;
}

type PanelAlign = "start" | "center" | "end";

const PANEL_ALIGN_CLASS: Record<PanelAlign, string> = { center: "items-center", end: "items-end", start: "items-start" };

// The panel grows out from the trigger's centre, so its settled box is known before the animation starts.
// Near an edge the scroller can't move far enough, so it grows away from that edge instead of being clipped.
function revealPanel({ anchor, panel, trigger, content, list }: PanelParts, smooth: boolean): PanelAlign {
  const height = panel.offsetHeight - trigger.offsetHeight - content.offsetHeight + list.offsetHeight;
  const anchorBox = anchor.getBoundingClientRect();

  const scroller = resolveScrollParent(anchor);
  const visibleTop = (scroller ? scroller.getBoundingClientRect().top : 0) + REVEAL_MARGIN_PX;
  const visibleBottom = visibleTop + (scroller ? scroller.clientHeight : window.innerHeight) - REVEAL_MARGIN_PX * 2;
  const scrolled = scroller ? scroller.scrollTop : window.scrollY;
  const scrollable = scroller ? scroller.scrollHeight - scroller.clientHeight : document.documentElement.scrollHeight - window.innerHeight;

  const scrollNeeded = (top: number): number => {
    const overTop = top - visibleTop;
    const overBottom = top + height - visibleBottom;
    return overTop < 0 ? overTop : Math.max(0, Math.min(overBottom, overTop));
  };

  const centred = scrollNeeded(anchorBox.top + anchorBox.height / 2 - height / 2);
  const reachable = centred >= -scrolled && centred <= scrollable - scrolled;
  const align: PanelAlign = reachable ? "center" : centred < 0 ? "start" : "end";
  const needed = align === "center" ? centred : scrollNeeded(align === "start" ? anchorBox.top : anchorBox.bottom - height);
  const delta = Math.min(Math.max(needed, -scrolled), scrollable - scrolled);

  if (delta !== 0) (scroller ?? window).scrollBy({ top: delta, behavior: smooth ? "smooth" : "auto" });
  return align;
}

type NavigationMenuPopoverProps = {
  trigger: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  size?: MenuItemSize;
  className?: string;
};

// A compact trigger is raised like the selected segment of the tabs it sits beside.
const COMPACT_TRIGGER = "bg-background-elevated shadow-xs";

export function NavigationMenuPopover({
  trigger,
  children,
  disabled,
  size = "default",
  className,
}: NavigationMenuPopoverProps) {
  const [expanded, setExpanded] = useState(false);
  const [present, setPresent] = useState(false);
  const containerRef = useRef<HTMLLIElement>(null);
  const setOverlay = useSetPopoverOverlay();
  const variant = use(MenuVariantContext);

  const close = useCallback(() => {
    setExpanded(false);
    setOverlay(false);
  }, [setOverlay]);

  const open = useCallback(() => {
    setExpanded(true);
    setPresent(true);
    setOverlay(true);
  }, [setOverlay]);

  const toggle = useCallback(() => {
    if (expanded) {
      close();
      return;
    }
    open();
  }, [expanded, close, open]);

  useEffect(() => () => setOverlay(false), [setOverlay]);

  useEffect(() => {
    if (!expanded) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current
        && event.target instanceof Node
        && !containerRef.current.contains(event.target)
      ) {
        close();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [expanded, close]);

  // A sticky ancestor traps this row's z-20 under the blur overlay; the attribute lets it lift itself with has-[[data-popover-open]]:z-20.
  return (
    <PopoverContext value={{ expanded, toggle, close, triggerContent: trigger }}>
      <li
        ref={containerRef}
        data-popover-open={present || undefined}
        className={cn(
          "relative grid grid-cols-1 grid-rows-1 *:row-start-1 *:col-start-1",
          present ? "z-20" : "z-0",
          className,
        )}
      >
        <ItemDisabledContext value={Boolean(disabled)}>
          <button
            type="button"
            onClick={disabled ? undefined : toggle}
            disabled={disabled}
            className={navigationMenuItemStyle({
              variant,
              interactive: !disabled,
              size,
              className: cn("relative z-10", size === "compact" && COMPACT_TRIGGER),
            })}
          >
            {trigger}
            <ChevronsUpDown
              size={size === "compact" ? 14 : 15}
              className={navigationMenuItemIconStyle({
                variant,
                disabled,
                className: "ml-auto shrink-0",
              })}
            />
          </button>
        </ItemDisabledContext>
        <LazyMotion features={loadMotionFeatures}>
          <AnimatePresence onExitComplete={() => setPresent(false)}>
            {expanded && <NavigationMenuPopoverPanel size={size}>{children}</NavigationMenuPopoverPanel>}
          </AnimatePresence>
        </LazyMotion>
      </li>
    </PopoverContext>
  );
}

function NavigationMenuPopoverPanel({ children, size }: PropsWithChildren<{ size: MenuItemSize }>) {
  const { expanded, triggerContent } = usePopover();
  const variant = use(MenuVariantContext);
  const reduceMotion = useReducedMotion() ?? false;
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [align, setAlign] = useState<PanelAlign>("center");

  useLayoutEffect(() => {
    if (!expanded) return;
    const [anchor, panel, trigger, content, list] = [anchorRef, panelRef, triggerRef, contentRef, listRef].map((ref) => ref.current);
    if (!anchor || !panel || !trigger || !content || !list) return;
    setAlign(revealPanel({ anchor, panel, trigger, content, list }, !reduceMotion));
  }, [expanded, reduceMotion]);

  return (
    <m.div
      ref={anchorRef}
      className={cn("absolute grid justify-items-center -inset-0.75 pointer-events-none z-20", PANEL_ALIGN_CLASS[align])}
      initial={POPOVER_INITIAL}
    >
      <m.div
        ref={panelRef}
        className={navigationMenuStyle({
          variant,
          className: "w-full overflow-hidden pointer-events-auto",
        })}
        initial={SHADOW_HIDDEN}
        animate={SHADOW_VISIBLE}
        exit={SHADOW_HIDDEN}
      >
        <m.div
          ref={triggerRef}
          className="flex flex-col justify-end"
          initial={TRIGGER_INITIAL}
          animate={TRIGGER_ANIMATE}
          exit={TRIGGER_EXIT}
        >
          <div className={navigationMenuItemStyle({ variant, interactive: false, size })}>
            {triggerContent}
            <ChevronsUpDown
              size={size === "compact" ? 14 : 15}
              className={navigationMenuItemIconStyle({ variant, className: "ml-auto shrink-0" })}
            />
          </div>
        </m.div>
        <m.div
          ref={contentRef}
          className="overflow-hidden"
          initial={CONTENT_INITIAL}
          animate={CONTENT_ANIMATE}
          exit={CONTENT_EXIT}
        >
          <InsidePopoverContext value>
            <div ref={listRef} className="overflow-y-auto" style={POPOVER_CONTENT_STYLE}>
              {children}
            </div>
          </InsidePopoverContext>
        </m.div>
      </m.div>
    </m.div>
  );
}
