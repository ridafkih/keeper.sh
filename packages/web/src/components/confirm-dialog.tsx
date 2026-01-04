"use client";

import type { FC } from "react";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@/components/button";
import { button, input, dialogPopup } from "@/styles";
import { CardTitle, TextBody, TextCaption } from "@/components/typography";
import { TOOLTIP_CLEAR_DELAY_MS } from "@keeper.sh/constants";

interface CopyablePhraseProps {
  phrase: string;
}

const CopyablePhrase: FC<CopyablePhraseProps> = ({ phrase }) => {
  const [copied, setCopied] = useState(false);

  const handleClick = async (event: React.MouseEvent) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(phrase);
    setCopied(true);
    setTimeout(() => setCopied(false), TOOLTIP_CLEAR_DELAY_MS);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1 font-medium text-foreground hover:text-foreground-secondary transition-colors"
    >
      "{phrase}"{copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
};

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: "primary" | "danger";
  isConfirming: boolean;
  onConfirm: () => void;
  requirePhrase?: string;
}

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = "danger",
  isConfirming,
  onConfirm,
  requirePhrase,
}) => {
  const [inputValue, setInputValue] = useState("");

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setInputValue("");
    onOpenChange(nextOpen);
  };

  const phraseMatches = requirePhrase
    ? inputValue.toLowerCase() === requirePhrase.toLowerCase()
    : true;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Popup className={dialogPopup({ size: "sm" })}>
          <Dialog.Title render={<CardTitle />}>{title}</Dialog.Title>
          <Dialog.Description render={<TextBody className="mt-1 mb-3" />}>
            {description}
          </Dialog.Description>
          {requirePhrase && (
            <div className="flex flex-col gap-1.5 mb-3">
              <TextCaption as="span" className="text-foreground-secondary">
                Type <CopyablePhrase phrase={requirePhrase} /> to confirm
              </TextCaption>
              <input
                type="text"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                className={input({ size: "sm" })}
                autoComplete="off"
              />
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Dialog.Close className={button({ variant: "secondary", size: "sm" })}>
              Cancel
            </Dialog.Close>
            <Button
              disabled={!phraseMatches}
              isLoading={isConfirming}
              onClick={onConfirm}
              className={button({ variant: confirmVariant, size: "sm" })}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
