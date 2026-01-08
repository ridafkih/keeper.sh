import type { FC, PropsWithChildren } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import {
  HomeIcon,
  CalendarsIcon,
  CalendarSyncIcon,
  ReceiptIcon,
  BoltIcon,
} from "lucide-react";
import { DockIndicator } from "./dock-indicator";

/**
 * We name a map of icons so we can get the benefit
 * of not having to load icons over the network, yet
 * still being able to SSR.
 */
const iconMap = {
  HomeIcon,
  CalendarsIcon,
  CalendarSyncIcon,
  ReceiptIcon,
  BoltIcon,
} as const;

type IconName = keyof typeof iconMap;

interface DockItemProps {
  href: string;
  segment: string | null;
  icon: IconName;
}

const DockItem: FC<DockItemProps> = ({ href, segment, icon }) => {
  const Icon = iconMap[icon];

  return (
    <li>
      <Link
        draggable={false}
        className="relative hover:text-neutral-50 p-2 flex rounded-full"
        href={href}
      >
        <Icon className="z-20" size={20} strokeWidth={1.5} />
        <DockIndicator segment={segment} />
      </Link>
    </li>
  );
};

const getDockPositionClassName = (position: DockProps["position"]) => {
  if (position === "top") {
    return { className: "absolute top-8" };
  }
  return { className: "fixed bottom-8" };
};

interface DockProps {
  position?: "top" | "bottom";
}

const Dock: FC<PropsWithChildren<DockProps>> = ({ position = "bottom", children }) => (
  <>
    <nav
      className={clsx(
        "left-0 right-0 mx-auto p-1.5 rounded-full bg-neutral-950 w-fit text-neutral-300 z-100",
        getDockPositionClassName(position).className,
      )}
    >
      <ul className="flex items-center">{children}</ul>
    </nav>
    <div className="h-12" />
  </>
);

export { Dock, DockItem };
