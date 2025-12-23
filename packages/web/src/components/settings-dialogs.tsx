"use client";

import { stringSchema } from "@keeper.sh/data-schemas";
import { useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import { FormField } from "@/components/form-field";

function getStringFromFormData(formData: FormData, key: string): string {
  return stringSchema.assert(formData.get(key));
}

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
      setError(
        error instanceof Error ? error.message : "Failed to update name",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit Display Name"
      description="This is how your name appears across the app."
      size="sm"
      error={error}
      isSubmitting={isSubmitting}
      submitLabel="Save"
      submittingLabel="Saving..."
      submitVariant="primary"
      onSubmit={handleSubmit}
    >
      <FormField
        id="name"
        name="name"
        label="Name"
        type="text"
        value={nameValue}
        onChange={(event) => setNameValue(event.target.value)}
        autoComplete="name"
      />
    </FormDialog>
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
    const currentPassword = getStringFromFormData(formData, "currentPassword");
    const newPassword = getStringFromFormData(formData, "newPassword");
    const confirmPassword = getStringFromFormData(formData, "confirmPassword");

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
      setError(
        error instanceof Error ? error.message : "Failed to change password",
      );
    } finally {
      setIsSubmitting(false);
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
      submittingLabel="Changing..."
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
    const password = getStringFromFormData(formData, "password");

    try {
      await onDelete(password);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to delete account",
      );
      setIsSubmitting(false);
    }
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
      submittingLabel="Deleting..."
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
