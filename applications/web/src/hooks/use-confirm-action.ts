import { useState } from "react";

interface ConfirmActionState {
  isOpen: boolean;
  isConfirming: boolean;
  open: () => void;
  close: () => void;
  setIsOpen: (open: boolean) => void;
  confirm: (action: () => Promise<void>) => Promise<void>;
}

export const useConfirmAction = (): ConfirmActionState => {
  const [isOpen, setIsOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const open = (): void => setIsOpen(true);
  const close = (): void => setIsOpen(false);

  const confirm = async (action: () => Promise<void>): Promise<void> => {
    setIsConfirming(true);
    try {
      await action();
    } finally {
      setIsConfirming(false);
      setIsOpen(false);
    }
  };

  return { close, confirm, isConfirming, isOpen, open, setIsOpen };
};
