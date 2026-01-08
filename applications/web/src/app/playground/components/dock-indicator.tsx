"use client";

import { atom, useSetAtom, useAtomValue } from "jotai";
import { motion } from "motion/react";
import { useParams } from "next/navigation";
import type { FC } from "react";
import { useEffect } from "react";

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
      className="absolute inset-0 size-full rounded-full z-10 bg-linear-to-b from-neutral-700 to-neutral-800 border-y border-t-neutral-500 border-b-neutral-600"
    />
  );
};

export { DockIndicator, HashSync };
