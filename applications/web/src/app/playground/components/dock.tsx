"use client";

import type { ComponentProps, FC, PropsWithChildren } from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import { clsx } from "clsx";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { DynamicIcon } from "lucide-react/dynamic";

const hashAtom = atom("");

const HashSync: FC = () => {
  const setHash = useSetAtom(hashAtom);
  const params = useParams();

  useEffect(() => {
    setHash(decodeURIComponent(window.location.hash.replace("#", "")));
  }, [params, setHash]);

  return null;
};

interface DockIndicatorProps {
  attributedHash: string;
}

const DockIndicator: FC<DockIndicatorProps> = ({ attributedHash }) => {
  const hash = useAtomValue(hashAtom);

  if (hash !== attributedHash) {
    return null;
  }

  return (
    <motion.div
      layout
      layoutId="indicator"
      style={{ originY: "top" }}
      transition={{ duration: 0.16, ease: [0.5, 0, 0, 1] }}
      className="absolute inset-0 size-full rounded-full z-10 bg-neutral-800 border-y border-y-neutral-500"
    />
  );
};

interface DockItemProps {
  href: string;
  hash: string;
  iconName: ComponentProps<typeof DynamicIcon>["name"];
}

const DockItem: FC<DockItemProps> = ({ href, hash, iconName }) => (
    <li>
      <Link
        draggable={false}
        className="relative hover:text-neutral-50 p-2 flex rounded-full"
        href={href}
      >
        <DynamicIcon name={iconName} className="z-20" size={20} strokeWidth={1.5} />
        <DockIndicator attributedHash={hash} />
      </Link>
  </li>
);

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
    <HashSync />
    <nav
      className={clsx(
        "left-0 right-0 mx-auto p-1.5 rounded-full bg-neutral-950 w-fit text-neutral-300",
        getDockPositionClassName(position).className,
      )}
    >
      <ul className="flex items-center">{children}</ul>
    </nav>
    <div className="h-12" />
  </>
);

export { Dock, DockItem };
