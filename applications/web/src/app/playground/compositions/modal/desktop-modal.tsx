"use client";

import type { FC, PropsWithChildren } from "react";
import { motion } from "motion/react";
import { cn } from "../../utils/cn";

const EASING = [0.16, 0.85, 0.2, 1] as const;

interface DesktopModalProps {
  onClose: () => void;
  className?: string;
}

const DesktopModal: FC<PropsWithChildren<DesktopModalProps>> = ({ children, onClose, className }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.95 }}
    transition={{ duration: 0.2, ease: EASING }}
    className="fixed inset-0 z-200 flex items-center justify-center p-4"
    onClick={onClose}
  >
    {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Modal dialog"
      tabIndex={-1}
      className={cn("bg-white rounded-xl shadow-lg w-full max-w-md p-4", className)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  </motion.div>
);

export { DesktopModal };
