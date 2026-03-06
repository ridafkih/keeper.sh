import type { ComponentPropsWithoutRef, KeyboardEvent as ReactKeyboardEvent, PropsWithChildren, ReactNode } from "react";
import { createContext, use, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ChevronsUpDown, Pencil } from "lucide-react";
import { popoverOverlayAtom } from "../../state/popover-overlay";
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "tailwind-variants/lite";
import { Text } from "./text";

const navigationMenuStyle = tv({
  base: "flex flex-col rounded-2xl p-0.5",
  variants: {
    variant: {
      default: "bg-background-elevated border border-border-elevated shadow-xs",
      highlight: "bg-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

type MenuVariant = VariantProps<typeof navigationMenuStyle>["variant"];

const navigationMenuItemStyle = tv({
  base: "rounded-xl flex items-center gap-3 p-3 w-full",
  variants: {
    variant: {
      default: "",
      highlight: "bg-foreground",
    },
    interactive: {
      true: "hover:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      false: "",
    },
  },
  compoundVariants: [
    { variant: "default", interactive: true, className: "hover:bg-background-hover" },
    { variant: "highlight", interactive: true, className: "hover:bg-background-inverse-hover" },
  ],
  defaultVariants: {
    variant: "default",
    interactive: true,
  },
});

const navigationMenuItemIconStyle = tv({
  base: "shrink-0",
  variants: {
    variant: {
      default: "text-foreground-muted",
      highlight: "text-foreground-inverse",
    },
    disabled: {
      true: "text-foreground-disabled",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const navigationMenuCheckbox = tv({
  base: "size-4 rounded shrink-0 flex items-center justify-center border",
  variants: {
    variant: {
      default: "border-interactive-border",
      highlight: "border-foreground-inverse-muted",
    },
    checked: {
      true: "",
      false: "",
    },
  },
  compoundVariants: [
    { variant: "default", checked: true, className: "bg-foreground border-foreground" },
    { variant: "highlight", checked: true, className: "bg-foreground-inverse border-foreground-inverse" },
  ],
  defaultVariants: {
    variant: "default",
    checked: false,
  },
});

const navigationMenuCheckboxIcon = tv({
  base: "shrink-0",
  variants: {
    variant: {
      default: "text-foreground-inverse",
      highlight: "text-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const navigationMenuToggleTrack = tv({
  base: "w-8 h-5 rounded-full shrink-0 flex items-center p-0.5",
  variants: {
    variant: {
      default: "",
      highlight: "",
    },
    checked: {
      true: "",
      false: "",
    },
  },
  compoundVariants: [
    { variant: "default", checked: false, className: "bg-interactive-border" },
    { variant: "default", checked: true, className: "bg-foreground" },
    { variant: "highlight", checked: false, className: "bg-foreground-inverse-muted" },
    { variant: "highlight", checked: true, className: "bg-foreground-inverse" },
  ],
  defaultVariants: {
    variant: "default",
    checked: false,
  },
});

const navigationMenuToggleThumb = tv({
  base: "size-4 rounded-full",
  variants: {
    variant: {
      default: "bg-background-elevated",
      highlight: "bg-foreground",
    },
    checked: {
      true: "ml-auto",
      false: "",
    },
  },
  defaultVariants: {
    variant: "default",
    checked: false,
  },
});

const LABEL_TONE: Record<NonNullable<MenuVariant>, "muted" | "inverse"> = {
  default: "muted",
  highlight: "inverse",
};

const DISABLED_LABEL_TONE: Record<NonNullable<MenuVariant>, "disabled" | "inverseMuted"> = {
  default: "disabled",
  highlight: "inverseMuted",
};

const MenuVariantContext = createContext<MenuVariant>("default");
const ItemIsLinkContext = createContext(false);
const InsidePopoverContext = createContext(false);
const ItemDisabledContext = createContext(false);

type NavigationMenuProps = PropsWithChildren<
  VariantProps<typeof navigationMenuStyle> & { className?: string }
>;

export function NavigationMenu({ children, variant, className }: NavigationMenuProps) {
  return (
    <MenuVariantContext value={variant ?? "default"}>
      <ul className={navigationMenuStyle({ variant, className })}>
        {children}
      </ul>
    </MenuVariantContext>
  );
}

type NavigationMenuItemProps = PropsWithChildren<{
  to?: ComponentPropsWithoutRef<typeof Link>["to"];
  onClick?: () => void;
  onMouseEnter?: () => void;
  className?: string;
}>;

type NavigationMenuItemLabelProps = PropsWithChildren<{
  className?: string;
}>

type NavigationMenuItemTrailingProps = PropsWithChildren<{
  className?: string;
}>

export function NavigationMenuItem({ to, onClick, onMouseEnter, className, children }: NavigationMenuItemProps) {
  const variant = use(MenuVariantContext);
  const insidePopover = use(InsidePopoverContext);
  const interactive = !!(to || onClick);
  const itemClass = navigationMenuItemStyle({ variant, interactive, className });
  const Wrapper = insidePopover ? "div" : "li";

  const content = (
    <ItemIsLinkContext value={!!to}>
      {children}
    </ItemIsLinkContext>
  );

  if (to) {
    return (
      <Wrapper>
        <Link draggable="false" to={to} className={itemClass} onMouseEnter={onMouseEnter}>
          {content}
        </Link>
      </Wrapper>
    );
  }

  if (onClick) {
    return (
      <Wrapper>
        <button onClick={onClick} className={itemClass}>
          {content}
        </button>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <div className={itemClass}>
        {content}
      </div>
    </Wrapper>
  );
}

export function NavigationMenuItemIcon({ children }: PropsWithChildren) {
  const variant = use(MenuVariantContext);
  const disabled = use(ItemDisabledContext);

  return (
    <div className={navigationMenuItemIconStyle({ variant, disabled })}>
      {children}
    </div>
  );
}

export function NavigationMenuItemLabel({ children, className }: NavigationMenuItemLabelProps) {
  const variant = use(MenuVariantContext);
  const disabled = use(ItemDisabledContext);
  const toneMap = disabled ? DISABLED_LABEL_TONE : LABEL_TONE;

  return <Text size="sm" tone={toneMap[variant ?? "default"]} align="left" className={cn("min-w-0 truncate", className)()}>{children}</Text>;
}

export function NavigationMenuEmptyItem({ children }: PropsWithChildren) {
  const variant = use(MenuVariantContext);

  return (
    <li>
      <div className={navigationMenuItemStyle({ variant, interactive: false })}>
        <Text size="sm" tone={LABEL_TONE[variant ?? "default"]} align="center" className="w-full">{children}</Text>
      </div>
    </li>
  );
}

export function NavigationMenuItemTrailing({ children, className }: NavigationMenuItemTrailingProps) {
  const isLink = use(ItemIsLinkContext);
  const variant = use(MenuVariantContext);

  return (
    <>
      <div className={cn("flex grow min-w-0 items-center gap-1 justify-end", className)()}>
        {children}
        {isLink && <ArrowRight className={cn("shrink-0", navigationMenuItemIconStyle({ variant }))()} size={15} />}
      </div>
    </>
  );
}

type NavigationMenuToggleableItemProps = PropsWithChildren<{
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}>;

export function NavigationMenuCheckboxItem({
  checked,
  onCheckedChange,
  className,
  children,
}: NavigationMenuToggleableItemProps) {
  const variant = use(MenuVariantContext);

  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className={navigationMenuItemStyle({ variant, className })}
      >
        {children}
        <div className={navigationMenuCheckbox({ variant, checked, className: "ml-auto" })}>
          {checked && <Check size={12} className={navigationMenuCheckboxIcon({ variant })} />}
        </div>
      </button>
    </li>
  );
}

export function NavigationMenuToggleItem({
  checked,
  onCheckedChange,
  className,
  children,
}: NavigationMenuToggleableItemProps) {
  const variant = use(MenuVariantContext);

  return (
    <li>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className={navigationMenuItemStyle({ variant, className })}
      >
        {children}
        <div className={navigationMenuToggleTrack({ variant, checked, className: "ml-auto" })}>
          <div className={navigationMenuToggleThumb({ variant, checked })} />
        </div>
      </button>
    </li>
  );
}

type PopoverContextValue = {
  expanded: boolean;
  toggle: () => void;
  close: () => void;
  triggerContent: ReactNode;
};

const PopoverContext = createContext<PopoverContextValue | null>(null);

export function usePopover() {
  const ctx = use(PopoverContext);
  if (!ctx) throw new Error("NavigationMenuPopover subcomponents must be used within NavigationMenuPopover");
  return ctx;
}

export function NavigationMenuPopover({ trigger, children, disabled }: { trigger: ReactNode; children: ReactNode; disabled?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [present, setPresent] = useState(false);
  const [openedAt, setOpenedAt] = useState("");
  const { pathname } = useLocation();
  const containerRef = useRef<HTMLLIElement>(null);
  const setOverlay = useSetAtom(popoverOverlayAtom);
  const variant = use(MenuVariantContext);

  if (expanded && openedAt !== pathname) {
    setExpanded(false);
    setOverlay(false);
  }

  const close = () => {
    setExpanded(false);
    setOverlay(false);
  };

  const open = () => {
    setExpanded(true);
    setPresent(true);
    setOpenedAt(pathname);
    setOverlay(true);
  };

  const toggle = () => {
    if (expanded) close();
    else open();
  };

  useEffect(() => {
    if (!expanded) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && event.target instanceof Node && !containerRef.current.contains(event.target)) {
        close();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [expanded, setOverlay]);

  return (
    <PopoverContext value={{ expanded, toggle, close, triggerContent: trigger }}>
      <li ref={containerRef} className={cn("relative grid grid-cols-1 grid-rows-1 *:row-start-1 *:col-start-1", present ? "z-20" : "z-0")()}>
        <ItemDisabledContext value={!!disabled}>
          <button
            type="button"
            onClick={disabled ? undefined : toggle}
            disabled={disabled}
            className={navigationMenuItemStyle({ variant, interactive: !disabled, className: "relative z-10" })}
          >
            {trigger}
            <ChevronsUpDown size={15} className={navigationMenuItemIconStyle({ variant, disabled, className: "ml-auto shrink-0" })} />
          </button>
        </ItemDisabledContext>
        <AnimatePresence onExitComplete={() => setPresent(false)}>
          {expanded && (
            <NavigationMenuPopoverPanel>
              {children}
            </NavigationMenuPopoverPanel>
          )}
        </AnimatePresence>
      </li>
    </PopoverContext>
  );
}

function NavigationMenuPopoverPanel({ children }: PropsWithChildren) {
  const { triggerContent } = usePopover();
  const variant = use(MenuVariantContext);

  return (
    <motion.div
      className="absolute grid place-items-center -inset-0.75 pointer-events-none z-20"
      initial={{ opacity: 1 }}
    >
      <motion.div
        className={navigationMenuStyle({
          variant,
          className: "w-full overflow-hidden pointer-events-auto"
        })}
        initial={{ boxShadow: "0 0 0 0 rgba(0,0,0,0)" }}
        animate={{ boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)" }}
        exit={{ boxShadow: "0 0 0 0 rgba(0,0,0,0)" }}
      >
        <motion.div
          className="flex flex-col justify-end"
          initial={{ height: "fit-content", filter: "blur(4px)", opacity: 1 }}
          animate={{ height: 0, filter: "blur(0)", opacity: 0 }}
          exit={{ height: "fit-content", filter: "blur(0)", opacity: 1 }}
        >
          <div className={navigationMenuItemStyle({ variant, interactive: false })}>
            {triggerContent}
            <ChevronsUpDown size={15} className={navigationMenuItemIconStyle({ variant, className: "ml-auto shrink-0" })} />
          </div>
        </motion.div>
        <motion.div
          className="overflow-hidden"
          initial={{ height: 0, filter: "blur(0)", opacity: 0 }}
          animate={{ height: "fit-content", filter: "blur(0)", opacity: 1 }}
          exit={{ height: 0, filter: "blur(4px)", opacity: 0 }}
        >
          <InsidePopoverContext value={true}>
            <div className="overflow-y-auto" style={{ maxHeight: "16rem" }}>
              {children}
            </div>
          </InsidePopoverContext>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

type NavigationMenuEditableItemProps = {
  value: string;
  onCommit: (value: string) => Promise<void> | void;
  label?: string;
  valueContent?: ReactNode;
  renderInput?: (value: string) => ReactNode;
  autoEdit?: boolean;
  disabled?: boolean;
  className?: string;
};

export function NavigationMenuEditableItem({
  value,
  onCommit,
  label,
  valueContent,
  renderInput,
  autoEdit,
  disabled,
  className,
}: NavigationMenuEditableItemProps) {
  const variant = use(MenuVariantContext);
  const [editing, setEditing] = useState(autoEdit ?? false);
  const [liveValue, setLiveValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);

  const startEditing = () => {
    setLiveValue(value);
    setEditing(true);
  };

  const commit = async () => {
    if (committingRef.current) return;
    const trimmed = inputRef.current?.value.trim();
    if (!trimmed || trimmed === value) {
      setEditing(false);
      return;
    }
    committingRef.current = true;
    await onCommit(trimmed);
    committingRef.current = false;
    setEditing(false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      setEditing(false);
    }
  };

  if (editing) {
    const inputClass = cn("min-w-0 text-sm tracking-tight bg-transparent cursor-text outline-none", label ? "flex-1 text-right" : "flex-1");

    const sharedInputProps = {
      ref: inputRef,
      type: "text" as const,
      defaultValue: value,
      autoComplete: "off",
      onBlur: commit,
      onKeyDown: handleKeyDown,
      autoFocus: true,
    };

    return (
      <li className="relative z-10 rounded-xl has-focus:ring-2 has-focus:ring-ring">
        <div className={navigationMenuItemStyle({ variant, interactive: false, className })}>
          {label && <NavigationMenuItemLabel className="shrink-0">{label}</NavigationMenuItemLabel>}
          {renderInput ? (
            <div className={cn(inputClass(), "grid items-center")()}>
              <input
                {...sharedInputProps}
                onChange={(e) => setLiveValue(e.target.value)}
                className={cn("col-start-1 row-start-1 w-full text-sm tracking-tight bg-transparent text-transparent caret-foreground-muted cursor-text outline-none", label && "text-right")()}
              />
              <span className={cn("col-start-1 row-start-1 pointer-events-none text-sm tracking-tight truncate whitespace-pre", label && "text-right")()}>
                {renderInput(liveValue)}
              </span>
            </div>
          ) : (
            <input
              {...sharedInputProps}
              className={cn(inputClass(), "text-foreground-muted")()}
            />
          )}
        </div>
      </li>
    );
  }

  return (
    <li>
      <ItemDisabledContext value={!!disabled}>
        <button
          type="button"
          onClick={() => !disabled && startEditing()}
          disabled={disabled}
          className={navigationMenuItemStyle({ variant, interactive: !disabled, className })}
        >
          {label && <NavigationMenuItemLabel className="shrink-0">{label}</NavigationMenuItemLabel>}
          <Text size="sm" tone={(disabled ? DISABLED_LABEL_TONE : LABEL_TONE)[variant ?? "default"]} className={cn("min-w-0 truncate", label && "flex-1 text-right")()}>{valueContent ?? value}</Text>
          <Pencil size={14} className={navigationMenuItemIconStyle({ variant, disabled, className: label ? "shrink-0" : "ml-auto" })} />
        </button>
      </ItemDisabledContext>
    </li>
  );
}
