"use client";

import type { ReactNode } from "react";
import { stringSchema } from "@keeper.sh/data-schemas";
import { FormDialog } from "@/components/form-dialog";
import { FormField } from "@/components/form-field";
import { useFormSubmit } from "@/hooks/use-form-submit";

const MIN_PASSWORD_LENGTH = 8;

const getStringFromFormData = (formData: FormData, key: string): string =>
  stringSchema.assert(formData.get(key));

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ChangePasswordDialogProps extends DialogProps {
  onSave: (currentPassword: string, newPassword: string) => Promise<void>;
}

const ChangePasswordDialog = ({
  open,
  onOpenChange,
  onSave,
}: ChangePasswordDialogProps): ReactNode => {
  const { isSubmitting, error, submit } = useFormSubmit<boolean>();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const currentPassword = getStringFromFormData(formData, "currentPassword");
    const newPassword = getStringFromFormData(formData, "newPassword");
    const confirmPassword = getStringFromFormData(formData, "confirmPassword");

    const result = await submit(async () => {
      if (newPassword !== confirmPassword) {
        throw new Error("New passwords do not match");
      }

      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        throw new Error("New password must be at least 8 characters");
      }

      await onSave(currentPassword, newPassword);
      return true;
    });

    if (result) {
      onOpenChange(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change Password"
      description="Enter your current password and choose a new one."
      size="sm"
      error={error}
      isSubmitting={isSubmitting}
      submitLabel="Change Password"
      submitVariant="primary"
      onSubmit={handleSubmit}
    >
      <FormField
        id="currentPassword"
        name="currentPassword"
        label="Current Password"
        type="password"
        required
        autoComplete="current-password"
      />
      <FormField
        id="newPassword"
        name="newPassword"
        label="New Password"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
      />
      <FormField
        id="confirmPassword"
        name="confirmPassword"
        label="Confirm New Password"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
      />
    </FormDialog>
  );
};

interface DeleteAccountDialogProps extends DialogProps {
  onDelete: (password: string) => Promise<void>;
}

const DeleteAccountDialog = ({
  open,
  onOpenChange,
  onDelete,
}: DeleteAccountDialogProps): ReactNode => {
  const { isSubmitting, error, submit } = useFormSubmit();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const password = getStringFromFormData(formData, "password");

    await submit(async () => {
      await onDelete(password);
    });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete Account"
      description="This action cannot be undone. All your calendars, integrations, and data will be permanently deleted."
      size="sm"
      error={error}
      isSubmitting={isSubmitting}
      submitLabel="Delete Account"
      submitVariant="danger"
      onSubmit={handleSubmit}
    >
      <FormField
        id="deletePassword"
        name="password"
        label="Enter your password to confirm"
        type="password"
        required
        autoComplete="current-password"
      />
    </FormDialog>
  );
};

export { ChangePasswordDialog, DeleteAccountDialog };
