import type { ComponentPropsWithoutRef, KeyboardEvent, PropsWithChildren } from "react";
import { createContext, use, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Pencil } from "lucide-react";
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "tailwind-variants/lite";
import { Text } from "./text";

const navigationMenuStyle = tv({
  base: "flex flex-col rounded-2xl overflow-hidden p-0.5",
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
  base: "rounded-xl flex items-center justify-between gap-3 p-3 w-full",
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
  base: "min-w-0",
  variants: {
    variant: {
      default: "text-foreground-muted",
      highlight: "text-foreground-inverse",
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

const MenuVariantContext = createContext<MenuVariant>("default");
const ItemIsLinkContext = createContext(false);

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

export function NavigationMenuItem({ to, onClick, onMouseEnter, className, children }: NavigationMenuItemProps) {
  const variant = use(MenuVariantContext);
  const interactive = !!(to || onClick);
  const itemClass = navigationMenuItemStyle({ variant, interactive, className });

  const content = (
    <ItemIsLinkContext value={!!to}>
      {children}
    </ItemIsLinkContext>
  );

  if (to) {
    return (
      <li>
        <Link to={to} className={itemClass} onMouseEnter={onMouseEnter}>
          {content}
        </Link>
      </li>
    );
  }

  if (onClick) {
    return (
      <li>
        <button onClick={onClick} className={itemClass}>
          {content}
        </button>
      </li>
    );
  }

  return (
    <li>
      <div className={itemClass}>
        {content}
      </div>
    </li>
  );
}

export function NavigationMenuItemIcon({ children }: PropsWithChildren) {
  const variant = use(MenuVariantContext);

  return (
    <div className={cn("flex items-center gap-2 min-w-0 [&>:not(p)]:shrink-0", navigationMenuItemIconStyle({ variant }))()}>
      {children}
    </div>
  );
}

export function NavigationMenuItemLabel({ children }: PropsWithChildren) {
  const variant = use(MenuVariantContext);

  return <Text size="sm" tone={LABEL_TONE[variant ?? "default"]} align="left" className="truncate">{children}</Text>;
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

export function NavigationMenuItemTrailing({ children }: PropsWithChildren) {
  const isLink = use(ItemIsLinkContext);
  const variant = use(MenuVariantContext);

  return (
    <div className="flex items-center gap-2 shrink-0">
      {children}
      {isLink && <ArrowRight className={cn("shrink-0", navigationMenuItemIconStyle({ variant }))()} size={15} />}
    </div>
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
        <div className={navigationMenuCheckbox({ variant, checked })}>
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
        <div className={navigationMenuToggleTrack({ variant, checked })}>
          <div className={navigationMenuToggleThumb({ variant, checked })} />
        </div>
      </button>
    </li>
  );
}

type NavigationMenuEditableItemProps = {
  value: string;
  onCommit: (value: string) => Promise<void> | void;
  className?: string;
};

export function NavigationMenuEditableItem({
  value,
  onCommit,
  className,
}: NavigationMenuEditableItemProps) {
  const variant = use(MenuVariantContext);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);

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

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <li className="rounded-xl has-[:focus]:ring-2 has-[:focus]:ring-ring">
        <div className={navigationMenuItemStyle({ variant, interactive: false, className })}>
          <input
            ref={inputRef}
            type="text"
            defaultValue={value}
            autoComplete="off"
            onBlur={commit}
            onKeyDown={handleKeyDown}
            autoFocus
            className="text-sm tracking-tight text-foreground-muted bg-transparent w-full cursor-text outline-none"
          />
        </div>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={navigationMenuItemStyle({ variant, interactive: true, className })}
      >
        <NavigationMenuItemIcon>
          <NavigationMenuItemLabel>{value}</NavigationMenuItemLabel>
        </NavigationMenuItemIcon>
        <Pencil size={14} className={navigationMenuItemIconStyle({ variant })} />
      </button>
    </li>
  );
}
