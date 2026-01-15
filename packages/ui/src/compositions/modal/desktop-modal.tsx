"use client";

import type { FC, PropsWithChildren } from "react";
import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { cn } from "../../utils/cn";
import { MODAL_ANIMATION } from "../../tokens/motion";

interface DesktopModalProps {
  onClose: () => void;
  className?: string;
}

const DesktopModal: FC<PropsWithChildren<DesktopModalProps>> = ({ children, onClose, className }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousActiveElement.current = document.activeElement as HTMLElement;
    dialogRef.current?.focus();

    return () => {
      previousActiveElement.current?.focus();
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "Tab") {
        const focusableElements = dialog.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (event.shiftKey) {
          if (document.activeElement === firstElement) {
            lastElement.focus();
            event.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement) {
            firstElement.focus();
            event.preventDefault();
          }
        }
      }
    };

    dialog.addEventListener("keydown", handleKeyDown);
    return () => dialog.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={MODAL_ANIMATION.desktop}
      className="hidden md:flex fixed inset-0 z-200 items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby="modal-description"
        tabIndex={-1}
        className={cn("bg-surface-subtle rounded-xl shadow-lg w-full max-w-md p-4 outline-none", className)}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </motion.div>
  );
};

export { DesktopModal };
