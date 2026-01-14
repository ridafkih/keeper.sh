"use client";

import type { FC, PropsWithChildren } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useIsMobile } from "../../hooks/use-is-mobile";
import { DesktopModal } from "./desktop-modal";
import { MobileSheet } from "./mobile-sheet";
import { Heading3 } from "../../components/heading";
import { Copy } from "../../components/copy";
import { Button, ButtonText } from "../../components/button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  className?: string;
}

const getModalComponent = (isMobile: boolean) => {
  if (isMobile) {
    return MobileSheet;
  }
  return DesktopModal;
};

const Modal: FC<PropsWithChildren<ModalProps>> = ({ open, onClose, className, children }) => {
  const isMobile = useIsMobile();
  const ModalComponent = getModalComponent(isMobile);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-150"
          />
          <ModalComponent onClose={onClose} className={className}>
            <div className="flex flex-col">
              {children}
            </div>
          </ModalComponent>
        </>
      )}
    </AnimatePresence>
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
      <Heading3>{title}</Heading3>
      {description && <Copy className="text-xs">{description}</Copy>}
    </div>
    {onClose && (
      <button
        type="button"
        onClick={onClose}
        className="self-start p-1 rounded-xl hover:bg-neutral-100 transition-colors text-neutral-400 hover:text-neutral-600"
      >
        <X size={16} />
      </button>
    )}
  </div>
);

const ModalContent: FC<PropsWithChildren> = ({ children }) => (
  <div className="flex flex-col gap-2">{children}</div>
);

interface ModalFooterProps {
  onCancel: () => void;
  onConfirm: () => void;
  cancelText?: string;
  confirmText?: string;
  variant?: "default" | "danger";
}

const getConfirmButtonClassName = (variant: "default" | "danger") => {
  if (variant === "danger") {
    return "flex-1 bg-red-500 border-red-400";
  }
  return "flex-1";
};

const ModalFooter: FC<ModalFooterProps> = ({
  onCancel,
  onConfirm,
  cancelText = "Cancel",
  confirmText = "Confirm",
  variant = "default",
}) => (
  <div className="flex gap-2 mt-2">
    <Button variant="outline" onClick={onCancel} className="flex-1">
      <ButtonText>{cancelText}</ButtonText>
    </Button>
    <Button onClick={onConfirm} className={getConfirmButtonClassName(variant)}>
      <ButtonText>{confirmText}</ButtonText>
    </Button>
  </div>
);

export { Modal, ModalHeader, ModalContent, ModalFooter };
