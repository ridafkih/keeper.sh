"use client";

import type { FC, PropsWithChildren } from "react";
import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { cn } from "../../utils/cn";
import { MODAL_ANIMATION } from "../../tokens/motion";

interface MobileSheetProps {
  onClose: () => void;
  className?: string;
}

const MobileSheet: FC<PropsWithChildren<MobileSheetProps>> = ({ children, onClose, className }) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousActiveElement.current = document.activeElement as HTMLElement;
    sheetRef.current?.focus();

    return () => {
      previousActiveElement.current?.focus();
    };
  }, []);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    sheet.addEventListener("keydown", handleKeyDown);
    return () => sheet.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={MODAL_ANIMATION.mobile}
      className="md:hidden fixed inset-x-0 bottom-0 z-200"
    >
      <div className="w-full max-w-12 h-1 rounded-xl bg-surface-subtle mx-auto mb-1" />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby="modal-description"
        tabIndex={-1}
        className={cn("flex flex-col bg-surface-subtle rounded-t-xl shadow-lg overflow-auto max-h-[calc(90vh-0.75rem)] p-4 outline-none", className)}
      >
        <div className="flex-1 flex flex-col">{children}</div>
      </div>
    </motion.div>
  );
};

export { MobileSheet };
