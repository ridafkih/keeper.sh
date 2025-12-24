"use client";

import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { button, dialogPopup } from "@/styles";

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  size: "sm" | "md" | "lg";
  children: React.ReactNode;
  error: string | null;
  isSubmitting: boolean;
  submitLabel: string;
  submittingLabel: string;
  submitVariant: "primary" | "danger";
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  trigger?: React.ReactElement;
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  size,
  children,
  error,
  isSubmitting,
  submitLabel,
  submittingLabel,
  submitVariant,
  onSubmit,
  trigger,
}: FormDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger render={trigger} />}
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Popup className={dialogPopup({ size })}>
          <Dialog.Title className="text-sm font-semibold text-zinc-900 tracking-tight">
            {title}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-zinc-500 mt-1 mb-3">
            {description}
          </Dialog.Description>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            {children}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2 justify-end">
              <Dialog.Close className={button({ variant: "secondary", size: "sm" })}>
                Cancel
              </Dialog.Close>
              <Button
                type="submit"
                disabled={isSubmitting}
                className={button({ variant: submitVariant, size: "sm" })}
              >
                {isSubmitting ? submittingLabel : submitLabel}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
