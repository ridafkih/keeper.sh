import type { FC, PropsWithChildren } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { Provider } from "jotai";
import {
  HomeIcon,
  CalendarsIcon,
  CalendarSyncIcon,
  ReceiptIcon,
  BoltIcon,
} from "lucide-react";
import { DockIndicator, HashSync } from "./dock-indicator";

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
  hash: string;
  icon: IconName;
}

const DockItem: FC<DockItemProps> = ({ href, hash, icon }) => {
  const Icon = iconMap[icon];

  return (
    <li>
      <Link
        draggable={false}
        className="relative hover:text-neutral-50 p-2 flex rounded-full"
        href={href}
      >
        <Icon className="z-20" size={20} strokeWidth={1.5} />
        <DockIndicator attributedHash={hash} />
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
    <Provider>
      <HashSync />
      <nav
        className={clsx(
          "left-0 right-0 mx-auto p-1.5 rounded-full bg-neutral-950 w-fit text-neutral-300",
          getDockPositionClassName(position).className,
        )}
      >
        <ul className="flex items-center">{children}</ul>
      </nav>
    </Provider>
    <div className="h-12" />
  </>
);

export { Dock, DockItem };
