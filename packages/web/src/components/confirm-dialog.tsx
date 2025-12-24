"use client";

import { useState, useEffect } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { button, input, dialogPopup } from "@/styles";

const CopyablePhrase = ({ phrase }: { phrase: string }) => {
  const [copied, setCopied] = useState(false);

  const handleClick = async (event: React.MouseEvent) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(phrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1 font-medium text-zinc-900 hover:text-zinc-600 transition-colors"
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
  confirmingLabel: string;
  confirmVariant?: "primary" | "danger";
  isConfirming: boolean;
  onConfirm: () => void;
  requirePhrase?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmingLabel,
  confirmVariant = "danger",
  isConfirming,
  onConfirm,
  requirePhrase,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    if (!open) setInputValue("");
  }, [open]);

  const phraseMatches = requirePhrase
    ? inputValue.toLowerCase() === requirePhrase.toLowerCase()
    : true;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Popup className={dialogPopup({ size: "sm" })}>
          <Dialog.Title className="text-sm font-semibold text-zinc-900 tracking-tight">
            {title}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-zinc-500 mt-1 mb-3">
            {description}
          </Dialog.Description>
          {requirePhrase && (
            <div className="flex flex-col gap-1.5 mb-3">
              <span className="text-xs text-zinc-600">
                Type <CopyablePhrase phrase={requirePhrase} /> to confirm
              </span>
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
              disabled={isConfirming || !phraseMatches}
              onClick={onConfirm}
              className={button({ variant: confirmVariant, size: "sm" })}
            >
              {isConfirming ? confirmingLabel : confirmLabel}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
