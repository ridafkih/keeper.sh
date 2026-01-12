"use client";

import type { ComponentPropsWithoutRef, FC, PropsWithChildren } from "react";
import {
  Root,
  Trigger,
  Group,
  Sub,
  RadioGroup,
  Portal,
  Content,
  Item,
  CheckboxItem,
  RadioItem,
  Label,
  Separator,
  SubTrigger,
  SubContent,
  ItemIndicator,
} from "@radix-ui/react-dropdown-menu";
import { clsx } from "clsx";
import { Check, ChevronDown, ChevronRight } from "lucide-react";

type DropdownMenuSize = "default" | "small";

const DropdownMenu = Root;

interface DropdownMenuTriggerProps extends ComponentPropsWithoutRef<typeof Trigger> {
  dropdownSize?: DropdownMenuSize;
}

const triggerSizeStyles: Record<DropdownMenuSize, string> = {
  default: "py-1.5 px-4 text-sm",
  small: "py-1.25 px-3.5 text-sm",
};

const getChevronSize = (size: DropdownMenuSize): number => {
  if (size === "small") {
    return 12;
  }
  return 14;
};

const DropdownMenuTrigger: FC<PropsWithChildren<DropdownMenuTriggerProps>> = ({
  children,
  className,
  dropdownSize = "default",
  ...props
}) => (
  <Trigger
    className={clsx(
      "bg-linear-to-b from-white to-neutral-50 border-y border-t-neutral-100 border-b-neutral-200 text-neutral-800 shadow-xs",
      "tracking-tighter font-medium rounded-xl w-fit cursor-pointer",
      "flex items-center gap-1 hover:brightness-95 transition-all",
      triggerSizeStyles[dropdownSize],
      className,
    )}
    {...props}
  >
    {children}
    <ChevronDown size={getChevronSize(dropdownSize)} />
  </Trigger>
);

const DropdownMenuGroup = Group;
const DropdownMenuSub = Sub;
const DropdownMenuRadioGroup = RadioGroup;

const DropdownMenuContent: FC<
  PropsWithChildren<ComponentPropsWithoutRef<typeof Content>>
> = ({ children, className, sideOffset = 4, align = "start", ...props }) => (
  <Portal>
    <Content
      sideOffset={sideOffset}
      align={align}
      className={clsx(
        "min-w-48 overflow-hidden rounded-xl bg-white p-1 shadow-lg",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
        "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    >
      {children}
    </Content>
  </Portal>
);

const DropdownMenuItem: FC<
  PropsWithChildren<ComponentPropsWithoutRef<typeof Item>>
> = ({ children, className, ...props }) => (
  <Item
    className={clsx(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-xl outline-none transition-colors",
      "text-neutral-700 text-sm p-2",
      "focus:bg-neutral-100",
      "data-disabled:pointer-events-none data-disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
  </Item>
);

const DropdownMenuCheckboxItem: FC<
  PropsWithChildren<ComponentPropsWithoutRef<typeof CheckboxItem>>
> = ({ children, className, checked, ...props }) => (
  <CheckboxItem
    className={clsx(
      "relative flex cursor-pointer select-none items-center rounded-xl outline-none transition-colors",
      "text-neutral-700 text-sm py-1.5 pl-7 pr-2",
      "focus:bg-neutral-100",
      "data-disabled:pointer-events-none data-disabled:opacity-50",
      className,
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex items-center justify-center">
      <ItemIndicator>
        <Check size={14} />
      </ItemIndicator>
    </span>
    {children}
  </CheckboxItem>
);

const DropdownMenuRadioItem: FC<
  PropsWithChildren<ComponentPropsWithoutRef<typeof RadioItem>>
> = ({ children, className, ...props }) => (
  <RadioItem
    className={clsx(
      "relative flex cursor-pointer select-none items-center rounded-xl outline-none transition-colors",
      "text-neutral-700 text-sm py-1.5 pl-7 pr-2",
      "focus:bg-neutral-100",
      "data-disabled:pointer-events-none data-disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex items-center justify-center">
      <ItemIndicator>
        <span className="size-1.5 rounded-xl bg-neutral-800" />
      </ItemIndicator>
    </span>
    {children}
  </RadioItem>
);

const DropdownMenuLabel: FC<
  PropsWithChildren<ComponentPropsWithoutRef<typeof Label>>
> = ({ children, className, ...props }) => (
  <Label
    className={clsx("px-2 py-1.5 text-xs text-neutral-400 font-medium", className)}
    {...props}
  >
    {children}
  </Label>
);

const DropdownMenuSeparator: FC<ComponentPropsWithoutRef<typeof Separator>> = ({
  className,
  ...props
}) => (
  <Separator
    className={clsx(
      "mx-1 my-1 h-px bg-[repeating-linear-gradient(to_right,var(--color-neutral-300),var(--color-neutral-300)_0.25rem,transparent_0.25rem,transparent_0.5rem)]",
      className,
    )}
    {...props}
  />
);

const DropdownMenuSubTrigger: FC<
  PropsWithChildren<ComponentPropsWithoutRef<typeof SubTrigger>>
> = ({ children, className, ...props }) => (
  <SubTrigger
    className={clsx(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-xl outline-none transition-colors",
      "text-neutral-700 text-sm py-1.5 px-2",
      "focus:bg-neutral-100 data-[state=open]:bg-neutral-100",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight size={14} className="ml-auto text-neutral-400" />
  </SubTrigger>
);

const DropdownMenuSubContent: FC<ComponentPropsWithoutRef<typeof SubContent>> = ({
  className,
  ...props
}) => (
  <SubContent
    className={clsx(
      "min-w-48 overflow-hidden rounded-xl bg-white p-1 shadow-lg",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
      "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
      "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
);

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
};
export type { DropdownMenuSize };
