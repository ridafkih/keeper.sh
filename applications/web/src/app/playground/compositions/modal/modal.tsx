"use client";

import type { FC, PropsWithChildren } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useIsMobile } from "../../hooks/use-is-mobile";
import { DesktopModal } from "./desktop-modal";
import { MobileSheet } from "./mobile-sheet";
import { Heading3 } from "../../components/heading";
import { Copy } from "../../components/copy";
import { Button, ButtonText } from "../../components/button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
}

const Modal: FC<PropsWithChildren<ModalProps>> = ({ open, onClose, children }) => {
  const isMobile = useIsMobile();

  const ModalComponent = isMobile ? MobileSheet : DesktopModal;

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
          <ModalComponent onClose={onClose}>
            {children}
          </ModalComponent>
        </>
      )}
    </AnimatePresence>
  );
};

interface ModalHeaderProps {
  title: string;
  description?: string;
}

const ModalHeader: FC<ModalHeaderProps> = ({ title, description }) => (
  <div className="flex flex-col gap-1 mb-4 pr-6">
    <Heading3>{title}</Heading3>
    {description && <Copy className="text-xs">{description}</Copy>}
  </div>
);

const ModalContent: FC<PropsWithChildren> = ({ children }) => (
  <div className="flex flex-col gap-3">{children}</div>
);

interface ModalFooterProps {
  onCancel: () => void;
  onConfirm: () => void;
  cancelText?: string;
  confirmText?: string;
  variant?: "default" | "danger";
}

const ModalFooter: FC<ModalFooterProps> = ({
  onCancel,
  onConfirm,
  cancelText = "Cancel",
  confirmText = "Confirm",
  variant = "default",
}) => (
  <div className="flex gap-2 mt-4">
    <Button variant="outline" onClick={onCancel} className="flex-1">
      <ButtonText>{cancelText}</ButtonText>
    </Button>
    <Button
      onClick={onConfirm}
      className={variant === "danger" ? "flex-1 bg-red-500 border-red-400" : "flex-1"}
    >
      <ButtonText>{confirmText}</ButtonText>
    </Button>
  </div>
);

export { Modal, ModalHeader, ModalContent, ModalFooter };
