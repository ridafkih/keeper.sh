"use client";

import type { FC, PropsWithChildren } from "react";
import { motion } from "motion/react";
import { cn } from "../../utils/cn";

const EASING = [0.16, 0.85, 0.2, 1] as const;

interface MobileSheetProps {
  onClose: () => void;
  className?: string;
}

const MobileSheet: FC<PropsWithChildren<MobileSheetProps>> = ({ children, onClose: _onClose, className }) => (
  <motion.div
    initial={{ y: "100%" }}
    animate={{ y: 0 }}
    exit={{ y: "100%" }}
    transition={{ duration: 0.3, ease: EASING }}
    className="fixed inset-x-0 bottom-0 z-200"
  >
    <div className="w-full max-w-12 h-1 rounded-xl bg-white mx-auto mb-1" />
    <div className={cn("flex flex-col bg-white rounded-t-xl shadow-lg overflow-auto max-h-[calc(90vh-0.75rem)] p-4", className)}>
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  </motion.div>
);

export { MobileSheet };
