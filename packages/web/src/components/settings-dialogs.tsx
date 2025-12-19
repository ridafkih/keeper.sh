"use client";

import { useState } from "react";
import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { button, input, label } from "@/styles";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface EditNameDialogProps extends DialogProps {
  initialName: string;
  onSave: (name: string) => Promise<void>;
}

export const EditNameDialog = ({
  open,
  onOpenChange,
  initialName,
  onSave,
}: EditNameDialogProps) => {
  const [nameValue, setNameValue] = useState(initialName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      await onSave(nameValue);
      onOpenChange(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to update name");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Popup className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-lg font-semibold text-gray-900 mb-1">
            Edit Display Name
          </Dialog.Title>
          <Dialog.Description className="text-sm text-gray-500 mb-4">
            This is how your name appears across the app.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="name" className={label()}>
                Name
              </label>
              <input
                id="name"
                type="text"
                value={nameValue}
                onChange={(event) => setNameValue(event.target.value)}
                className={input()}
                autoComplete="name"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 justify-end mt-2">
              <Dialog.Close className={button({ variant: "secondary" })}>
                Cancel
              </Dialog.Close>
              <Button
                type="submit"
                disabled={isSubmitting}
                className={button({ variant: "primary" })}
              >
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

interface ChangePasswordDialogProps extends DialogProps {
  onSave: (currentPassword: string, newPassword: string) => Promise<void>;
}

export const ChangePasswordDialog = ({
  open,
  onOpenChange,
  onSave,
}: ChangePasswordDialogProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    const formData = new FormData(event.currentTarget);
    const currentPassword = formData.get("currentPassword") as string;
    const newPassword = formData.get("newPassword") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      setIsSubmitting(false);
      return;
    }

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      setIsSubmitting(false);
      return;
    }

    try {
      await onSave(currentPassword, newPassword);
      onOpenChange(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to change password");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Popup className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-lg font-semibold text-gray-900 mb-1">
            Change Password
          </Dialog.Title>
          <Dialog.Description className="text-sm text-gray-500 mb-4">
            Enter your current password and choose a new one.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="currentPassword" className={label()}>
                Current Password
              </label>
              <input
                id="currentPassword"
                name="currentPassword"
                type="password"
                required
                className={input()}
                autoComplete="current-password"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="newPassword" className={label()}>
                New Password
              </label>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                minLength={8}
                className={input()}
                autoComplete="new-password"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="confirmPassword" className={label()}>
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                minLength={8}
                className={input()}
                autoComplete="new-password"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 justify-end mt-2">
              <Dialog.Close className={button({ variant: "secondary" })}>
                Cancel
              </Dialog.Close>
              <Button
                type="submit"
                disabled={isSubmitting}
                className={button({ variant: "primary" })}
              >
                {isSubmitting ? "Changing..." : "Change Password"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

interface DeleteAccountDialogProps extends DialogProps {
  onDelete: (password: string) => Promise<void>;
}

export const DeleteAccountDialog = ({
  open,
  onOpenChange,
  onDelete,
}: DeleteAccountDialogProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    const formData = new FormData(event.currentTarget);
    const password = formData.get("password") as string;

    try {
      await onDelete(password);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to delete account");
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Popup className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-lg font-semibold text-gray-900 mb-1">
            Delete Account
          </Dialog.Title>
          <Dialog.Description className="text-sm text-gray-500 mb-4">
            This action cannot be undone. All your calendars, integrations, and
            data will be permanently deleted.
          </Dialog.Description>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="deletePassword" className={label()}>
                Enter your password to confirm
              </label>
              <input
                id="deletePassword"
                name="password"
                type="password"
                required
                className={input()}
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 justify-end mt-2">
              <Dialog.Close className={button({ variant: "secondary" })}>
                Cancel
              </Dialog.Close>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center justify-center py-2 px-4 rounded-md text-sm font-medium border border-red-300 text-red-600 bg-transparent hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Deleting..." : "Delete Account"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
