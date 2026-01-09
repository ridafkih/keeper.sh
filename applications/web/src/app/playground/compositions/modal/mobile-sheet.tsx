"use client";

import type { FC, PropsWithChildren } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";

const EASING = [0.16, 0.85, 0.2, 1] as const;

interface MobileSheetProps {
  onClose: () => void;
}

const MobileSheet: FC<PropsWithChildren<MobileSheetProps>> = ({ children, onClose }) => (
  <motion.div
    initial={{ y: "100%" }}
    animate={{ y: 0 }}
    exit={{ y: "100%" }}
    transition={{ duration: 0.3, ease: EASING }}
    className="fixed inset-x-0 bottom-0 z-200"
  >
    <div className="w-full max-w-12 h-1 rounded-full bg-white mx-auto mb-1" />
    <div className="relative flex flex-col bg-white rounded-t-2xl shadow-lg overflow-auto max-h-[calc(90vh-12px)] min-h-[50vh] p-4">
      <button
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 p-1 rounded-lg hover:bg-neutral-100 transition-colors text-neutral-400 hover:text-neutral-600"
      >
        <X size={16} />
      </button>
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  </motion.div>
);

export { MobileSheet };
