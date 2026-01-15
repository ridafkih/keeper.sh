"use client";

import type { ComponentPropsWithoutRef, FC, PropsWithChildren } from "react";
import {
  Root,
  Trigger,
  Portal,
  Content,
  Close,
  Arrow,
} from "@radix-ui/react-popover";
import { cn } from "../utils/cn";

const Popover = Root;
const PopoverTrigger = Trigger;
const PopoverClose = Close;
const PopoverArrow = Arrow;

const PopoverContent: FC<
  PropsWithChildren<ComponentPropsWithoutRef<typeof Content>>
> = ({ children, className, sideOffset = 8, align = "start", ...props }) => (
  <Portal>
    <Content
      sideOffset={sideOffset}
      align={align}
      className={cn(
        "w-80 rounded-xl bg-surface p-4 shadow-lg border border-border",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2",
        "data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        "z-50",
        className,
      )}
      {...props}
    >
      {children}
    </Content>
  </Portal>
);

PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverTrigger, PopoverContent, PopoverClose, PopoverArrow };
