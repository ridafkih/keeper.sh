import { use, useCallback, useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from "react";
import { useSetAtom } from "jotai";
import { AnimatePresence, LazyMotion } from "motion/react";
import { loadMotionFeatures } from "../../../../lib/motion-features";
import * as m from "motion/react-m";
import ChevronsUpDown from "lucide-react/dist/esm/icons/chevrons-up-down";
import { cn } from "../../../../utils/cn";
import { popoverOverlayAtom } from "../../../../state/popover-overlay";
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

type NavigationMenuPopoverProps = {
  trigger: ReactNode;
  children: ReactNode;
  disabled?: boolean;
};

export function NavigationMenuPopover({
  trigger,
  children,
  disabled,
}: NavigationMenuPopoverProps) {
  const [expanded, setExpanded] = useState(false);
  const [present, setPresent] = useState(false);
  const containerRef = useRef<HTMLLIElement>(null);
  const setOverlay = useSetAtom(popoverOverlayAtom);
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

  return (
    <PopoverContext value={{ expanded, toggle, close, triggerContent: trigger }}>
      <li
        ref={containerRef}
        className={cn(
          "relative grid grid-cols-1 grid-rows-1 *:row-start-1 *:col-start-1",
          present ? "z-20" : "z-0",
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
              className: "relative z-10",
            })}
          >
            {trigger}
            <ChevronsUpDown
              size={15}
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
            {expanded && <NavigationMenuPopoverPanel>{children}</NavigationMenuPopoverPanel>}
          </AnimatePresence>
        </LazyMotion>
      </li>
    </PopoverContext>
  );
}

function NavigationMenuPopoverPanel({ children }: PropsWithChildren) {
  const { triggerContent } = usePopover();
  const variant = use(MenuVariantContext);

  return (
    <m.div
      className="absolute grid place-items-center -inset-0.75 pointer-events-none z-20"
      initial={POPOVER_INITIAL}
    >
      <m.div
        className={navigationMenuStyle({
          variant,
          className: "w-full overflow-hidden pointer-events-auto",
        })}
        initial={SHADOW_HIDDEN}
        animate={SHADOW_VISIBLE}
        exit={SHADOW_HIDDEN}
      >
        <m.div
          className="flex flex-col justify-end"
          initial={TRIGGER_INITIAL}
          animate={TRIGGER_ANIMATE}
          exit={TRIGGER_EXIT}
        >
          <div className={navigationMenuItemStyle({ variant, interactive: false })}>
            {triggerContent}
            <ChevronsUpDown
              size={15}
              className={navigationMenuItemIconStyle({ variant, className: "ml-auto shrink-0" })}
            />
          </div>
        </m.div>
        <m.div
          className="overflow-hidden"
          initial={CONTENT_INITIAL}
          animate={CONTENT_ANIMATE}
          exit={CONTENT_EXIT}
        >
          <InsidePopoverContext value>
            <div className="overflow-y-auto" style={POPOVER_CONTENT_STYLE}>
              {children}
            </div>
          </InsidePopoverContext>
        </m.div>
      </m.div>
    </m.div>
  );
}
