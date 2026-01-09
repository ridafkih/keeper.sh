"use client";

import type { FC, PropsWithChildren } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useModalOpen, useSetModalOpen } from "./modal-context";
import { useIsMobile } from "../../hooks/use-is-mobile";
import { DesktopModal } from "./desktop-modal";
import { MobileSheet } from "./mobile-sheet";

const Modal: FC<PropsWithChildren> = ({ children }) => {
  const isOpen = useModalOpen();
  const setOpen = useSetModalOpen();
  const isMobile = useIsMobile();

  const handleClose = () => setOpen(false);

  const ModalComponent = isMobile ? MobileSheet : DesktopModal;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/50 z-150"
          />
          <ModalComponent onClose={handleClose}>
            {children}
          </ModalComponent>
        </>
      )}
    </AnimatePresence>
  );
};

export { Modal };
