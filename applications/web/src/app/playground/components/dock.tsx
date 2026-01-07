"use client";

import { FC, PropsWithChildren } from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { LucideIcon } from "lucide-react";
import clsx from "clsx";

const useHash = () => {
  const [hash, setHash] = useState<string>("");
  const params = useParams();

  useEffect(() => {
    setHash(decodeURIComponent(window.location.hash.replace("#", "")));
  }, [params]);

  return hash;
};

type DockIndicatorProps = {
  attributedHash: string;
};

const DockIndicator: FC<DockIndicatorProps> = ({ attributedHash }) => {
  const hash = useHash();

  if (hash !== attributedHash) return null;

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

type DockItemProps = {
  href: string;
  hash: string;
  icon: LucideIcon;
};

export const DockItem: FC<DockItemProps> = ({ href, hash, icon: Icon }) => (
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

const getDockPositionClassName = (position: DockProps["position"]) => {
  if (position === "top") return { className: "absolute top-8" };
  return { className: "fixed bottom-8" };
}

type DockProps = {
  position?: "top" | "bottom";
};

export const Dock: FC<PropsWithChildren<DockProps>> = ({ position = "bottom", children }) => {
  return (
    <>
      <nav className={clsx("left-0 right-0 mx-auto p-1.5 rounded-full bg-neutral-950 w-fit text-neutral-300", getDockPositionClassName(position).className)}>
        <ul className="flex items-center">
          {children}
        </ul>
      </nav>
      <div className="h-12" />
    </>
  )
};
