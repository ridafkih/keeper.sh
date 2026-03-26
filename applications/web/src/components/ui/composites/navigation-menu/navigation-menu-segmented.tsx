import { navigationMenuItemStyle } from "./navigation-menu.styles";
import { Text } from "@/components/ui/primitives/text";
import * as m from "motion/react-m";
import { AnimatePresence } from "motion/react";

interface SegmentedControlOption {
  label: string;
  value: string;
}

interface NavigationMenuSegmentedProps {
  options: [SegmentedControlOption, SegmentedControlOption];
  value: string;
  onValueChange: (value: string) => void;
}

const itemClass = navigationMenuItemStyle({
  variant: "default",
  interactive: false,
  className: "flex-1 cursor-pointer relative",
});

export function NavigationMenuSegmented({ options, value, onValueChange }: NavigationMenuSegmentedProps) {
  const selectedIndex = options.findIndex((option) => option.value === value);

  return (
    <li className="flex gap-px overflow-hidden rounded-[0.875rem] relative">
      <AnimatePresence>
        <m.div
          initial={{ translateX: '-100%' }}
          animate={{ translateX: 0 }}
          transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
          className="flex absolute inset-0 pointer-events-none"
        >
          {options.map((option, index) => (
            <div key={option.value} className="flex-1">
              {index === selectedIndex && (
                <m.div
                  layoutId="segmented-indicator"
                  className="h-full bg-background-hover rounded-[0.875rem]"
                  transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
                />
              )}
            </div>
          ))}
        </m.div>
      </AnimatePresence>
      {options.map((option) => {
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onValueChange(option.value)}
            className={itemClass}
          >
            <Text size="sm" tone="default" align="center" className="relative w-full">
              {option.label}
            </Text>
          </button>
        );
      })}
    </li>
  );
}
