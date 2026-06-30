import type { ComponentPropsWithoutRef, PropsWithChildren } from "react";
import { use } from "react";
import { Link } from "@tanstack/react-router";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import { cn } from "@/utils/cn";
import {
  InsidePopoverContext,
  ItemDisabledContext,
  ItemIsLinkContext,
  MenuVariantContext,
} from "./navigation-menu.contexts";
import {
  DISABLED_LABEL_TONE,
  LABEL_TONE,
  navigationMenuItemIconStyle,
  navigationMenuItemStyle,
  navigationMenuStyle,
  navigationMenuToggleThumb,
  navigationMenuToggleTrack,
  type MenuVariant,
} from "./navigation-menu.styles";
import { CheckboxIndicator } from "@/components/ui/primitives/checkbox";
import { Text } from "@/components/ui/primitives/text";

type NavigationMenuProps = PropsWithChildren<{
  variant?: MenuVariant;
  className?: string;
}>;

export function NavigationMenu({
  children,
  variant,
  className,
}: NavigationMenuProps) {
  return (
    <MenuVariantContext value={variant ?? "default"}>
      <ul className={navigationMenuStyle({ variant, className })}>{children}</ul>
    </MenuVariantContext>
  );
}

type NavigationMenuItemProps = PropsWithChildren<{
  className?: string;
}>;

type NavigationMenuLinkItemProps = PropsWithChildren<{
  to?: ComponentPropsWithoutRef<typeof Link>["to"];
  onMouseEnter?: () => void;
  disabled?: boolean;
  className?: string;
}>;

type NavigationMenuButtonItemProps = PropsWithChildren<{
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}>;

type NavigationMenuItemLabelProps = PropsWithChildren<{
  className?: string;
}>;

type NavigationMenuItemTrailingProps = PropsWithChildren<{
  className?: string;
}>;

export function NavigationMenuItem({
  className,
  children,
}: NavigationMenuItemProps) {
  const variant = use(MenuVariantContext);
  const insidePopover = use(InsidePopoverContext);
  const itemClass = navigationMenuItemStyle({ variant, interactive: false, className });
  const Wrapper = insidePopover ? "div" : "li";
  const content = <ItemIsLinkContext value={false}>{children}</ItemIsLinkContext>;

  return (
    <Wrapper>
      <div className={itemClass}>{content}</div>
    </Wrapper>
  );
}

export function NavigationMenuLinkItem({
  to,
  onMouseEnter,
  disabled,
  className,
  children,
}: NavigationMenuLinkItemProps) {
  const variant = use(MenuVariantContext);
  const insidePopover = use(InsidePopoverContext);
  const interactive = Boolean(to) && !disabled;
  const itemClass = navigationMenuItemStyle({ variant, interactive, className });
  const Wrapper = insidePopover ? "div" : "li";
  const content = <ItemIsLinkContext value={interactive}>{children}</ItemIsLinkContext>;

  return (
    <Wrapper>
      <ItemDisabledContext value={Boolean(disabled)}>
        {interactive ? (
          <Link
            draggable="false"
            to={to}
            className={itemClass}
            onMouseEnter={onMouseEnter}
          >
            {content}
          </Link>
        ) : (
          <div className={itemClass} aria-disabled={disabled}>
            {content}
          </div>
        )}
      </ItemDisabledContext>
    </Wrapper>
  );
}

export function NavigationMenuButtonItem({
  onClick,
  disabled,
  className,
  children,
}: NavigationMenuButtonItemProps) {
  const variant = use(MenuVariantContext);
  const insidePopover = use(InsidePopoverContext);
  const interactive = Boolean(onClick) && !disabled;
  const itemClass = navigationMenuItemStyle({ variant, interactive, className });
  const Wrapper = insidePopover ? "div" : "li";
  const content = <ItemIsLinkContext value={false}>{children}</ItemIsLinkContext>;

  return (
    <Wrapper>
      <ItemDisabledContext value={Boolean(disabled)}>
        <button type="button" onClick={onClick} disabled={disabled} className={itemClass}>
          {content}
        </button>
      </ItemDisabledContext>
    </Wrapper>
  );
}

export function NavigationMenuItemIcon({ children }: PropsWithChildren) {
  const variant = use(MenuVariantContext);
  const disabled = use(ItemDisabledContext);

  return <div className={navigationMenuItemIconStyle({ variant, disabled })}>{children}</div>;
}

export function NavigationMenuItemLabel({
  children,
  className,
}: NavigationMenuItemLabelProps) {
  const variant = use(MenuVariantContext);
  const disabled = use(ItemDisabledContext);
  const toneMap = disabled ? DISABLED_LABEL_TONE : LABEL_TONE;

  return (
    <Text
      size="base"
      tone={toneMap[variant ?? "default"]}
      align="left"
      className={cn("min-w-0 truncate", className)}
    >
      {children}
    </Text>
  );
}

export function NavigationMenuEmptyItem({ children }: PropsWithChildren) {
  const variant = use(MenuVariantContext);

  return (
    <li>
      <div className={navigationMenuItemStyle({ variant, interactive: false })}>
        <Text
          size="base"
          tone={LABEL_TONE[variant ?? "default"]}
          align="center"
          className="w-full"
        >
          {children}
        </Text>
      </div>
    </li>
  );
}

export function NavigationMenuItemTrailing({
  children,
  className,
}: NavigationMenuItemTrailingProps) {
  const isLink = use(ItemIsLinkContext);
  const variant = use(MenuVariantContext);

  return (
    <div className={cn("flex grow min-w-0 items-center gap-1 justify-end", className)}>
      {children}
      {isLink && (
        <ArrowRight
          className={cn("shrink-0", navigationMenuItemIconStyle({ variant }))}
          size={15}
        />
      )}
    </div>
  );
}

type NavigationMenuToggleableItemProps = PropsWithChildren<{
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}>;

export function NavigationMenuCheckboxItem({
  checked,
  onCheckedChange,
  disabled,
  className,
  children,
}: NavigationMenuToggleableItemProps) {
  const variant = use(MenuVariantContext);

  return (
    <li>
      <ItemDisabledContext value={Boolean(disabled)}>
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => !disabled && onCheckedChange(!checked)}
          className={navigationMenuItemStyle({ variant, interactive: !disabled, className })}
        >
          {children}
          <CheckboxIndicator checked={checked} variant={variant} className="ml-auto" />
        </button>
      </ItemDisabledContext>
    </li>
  );
}

export function NavigationMenuToggleItem({
  checked,
  onCheckedChange,
  disabled,
  className,
  children,
}: NavigationMenuToggleableItemProps) {
  const variant = use(MenuVariantContext);

  return (
    <li>
      <ItemDisabledContext value={Boolean(disabled)}>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => !disabled && onCheckedChange(!checked)}
          className={navigationMenuItemStyle({ variant, interactive: !disabled, className })}
        >
          {children}
          <div
            className={navigationMenuToggleTrack({
              variant,
              checked,
              disabled,
              className: "ml-auto",
            })}
          >
            <div className={navigationMenuToggleThumb({ variant, checked })} />
          </div>
        </button>
      </ItemDisabledContext>
    </li>
  );
}
