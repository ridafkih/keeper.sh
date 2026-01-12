"use client";

import type { FC, PropsWithChildren } from "react";
import { motion } from "motion/react";

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
      className="bg-white rounded-xl shadow-lg w-full max-w-md p-4"
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  </motion.div>
);

export { DesktopModal };
