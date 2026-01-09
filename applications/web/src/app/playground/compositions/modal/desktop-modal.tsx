"use client";

import type { FC, PropsWithChildren } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";

const EASING = [0.16, 0.85, 0.2, 1] as const;

interface DesktopModalProps {
  onClose: () => void;
}

const DesktopModal: FC<PropsWithChildren<DesktopModalProps>> = ({ children, onClose }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.95 }}
    transition={{ duration: 0.2, ease: EASING }}
    className="fixed inset-0 z-200 flex items-center justify-center p-4"
    onClick={onClose}
  >
    <div
      className="relative bg-white rounded-xl shadow-lg w-full max-w-md p-4"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 p-1 rounded-lg hover:bg-neutral-100 transition-colors text-neutral-400 hover:text-neutral-600"
      >
        <X size={16} />
      </button>
      {children}
    </div>
  </motion.div>
);

export { DesktopModal };
