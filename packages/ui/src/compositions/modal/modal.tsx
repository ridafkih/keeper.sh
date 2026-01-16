"use client";

import type { FC, PropsWithChildren } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { DesktopModal } from "./desktop-modal";
import { MobileSheet } from "./mobile-sheet";
import { Heading3 } from "../../components/heading";
import { Copy } from "../../components/copy";
import { Button, ButtonText } from "../../components/button";
import { Divider } from "../../components/form-divider";
import { MODAL_ANIMATION } from "../../tokens/motion";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  className?: string;
}

const Modal: FC<PropsWithChildren<ModalProps>> = ({ open, onClose, className, children }) => {
  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={MODAL_ANIMATION.backdrop}
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 bg-black/50 z-150 backdrop-blur-[0.125rem]"
          />
        )}
      </AnimatePresence>
      {/* Desktop: centered modal with scale animation */}
      <AnimatePresence>
        {open && (
          <DesktopModal onClose={onClose} className={className}>
            <div className="flex flex-col gap-4">
              {children}
            </div>
          </DesktopModal>
        )}
      </AnimatePresence>
      {/* Mobile: bottom sheet with slide animation */}
      <AnimatePresence>
        {open && (
          <MobileSheet onClose={onClose} className={className}>
            <div className="flex flex-col gap-4">
              {children}
            </div>
          </MobileSheet>
        )}
      </AnimatePresence>
    </>
  );
};

interface ModalHeaderProps {
  title: string;
  description?: string;
  onClose?: () => void;
}

const ModalHeader: FC<ModalHeaderProps> = ({ title, description, onClose }) => (
  <div className="flex gap-2">
    <div className="flex flex-col gap-1 flex-1">
      <Heading3 id="modal-title">{title}</Heading3>
      {description && <Copy className="text-xs" id="modal-description">{description}</Copy>}
    </div>
    {onClose && (
      <button
        type="button"
        onClick={onClose}
        aria-label="Close modal"
        className="self-start p-1 rounded-xl hover:bg-surface-muted transition-colors text-foreground-subtle hover:text-foreground-secondary"
      >
        <X size={16} />
      </button>
    )}
  </div>
);

const ModalContent: FC<PropsWithChildren> = ({ children }) => (
  <div className="flex flex-col gap-4">{children}</div>
);

interface ModalFooterProps {
  onCancel: () => void;
  onConfirm: () => void;
  cancelText?: string;
  confirmText?: string;
  variant?: "default" | "danger";
  isForm?: boolean;
}

const ModalFooter: FC<ModalFooterProps> = ({
  onCancel,
  onConfirm,
  cancelText = "Cancel",
  confirmText = "Confirm",
  variant = "default",
  isForm = false,
}) => (
  <div className="flex flex-col gap-4">
    <Divider />
    <div className="flex gap-2">
      <Button variant="outline" onClick={onCancel} type="button" className="flex-1">
        <ButtonText>{cancelText}</ButtonText>
      </Button>
      <Button
        variant={variant === "danger" ? "destructive" : "primary"}
        onClick={isForm ? undefined : onConfirm}
        type={isForm ? "submit" : "button"}
        className="flex-1"
      >
        <ButtonText>{confirmText}</ButtonText>
      </Button>
    </div>
  </div>
);

export { Modal, ModalHeader, ModalContent, ModalFooter };
