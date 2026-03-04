import type { ComponentPropsWithoutRef, KeyboardEvent, PropsWithChildren } from "react";
import { createContext, use, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Pencil } from "lucide-react";
import type { VariantProps } from "tailwind-variants";
import { cn } from "tailwind-variants/lite";
import { Text } from "./text";
import {
  navigationMenu as navigationMenuStyle,
  navigationMenuItem as navigationMenuItemStyle,
  navigationMenuItemIcon as navigationMenuItemIconStyle,
  navigationMenuCheckbox,
  navigationMenuCheckboxIcon,
  navigationMenuToggleTrack,
  navigationMenuToggleThumb,
  LABEL_TONE,
  type MenuVariant,
} from "./navigation-menu.styles";

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
