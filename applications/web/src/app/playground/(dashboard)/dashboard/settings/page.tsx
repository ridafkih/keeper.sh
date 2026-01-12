"use client";

import type { FC } from "react";
import { useState } from "react";
import { Fingerprint } from "lucide-react";
import { Heading1, Heading2 } from "../../../components/heading";
import { Copy } from "../../../components/copy";
import { Input } from "../../../components/input";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "../../../compositions/modal/modal";
import { List, ListItem, ListItemButton, ListItemLabel, ListItemValue, ListItemAdd } from "../../../components/list";

interface Passkey {
  id: string;
  name: string;
  createdAt: Date;
}

const MOCK_PASSKEYS: Passkey[] = [
  {
    id: "pk-1",
    name: "MacBook Pro",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
  },
  {
    id: "pk-2",
    name: "iPhone 15",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
  },
];

const formatDate = (date: Date): string => {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const SettingsPage = () => {
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deletePasskeyOpen, setDeletePasskeyOpen] = useState<Passkey | null>(null);

  return (
    <div className="flex flex-col gap-8 pt-16 pb-8">
      <Heading1>Settings</Heading1>

      <div className="flex flex-col gap-2">
        <Heading2>Account</Heading2>
        <Copy className="text-xs">Manage your account settings.</Copy>
        <List>
          <ListItem id="email">
            <ListItemLabel>Email</ListItemLabel>
            <ListItemValue>john@example.com</ListItemValue>
          </ListItem>
          <ListItemButton id="change-password" onClick={() => setChangePasswordOpen(true)}>
            <ListItemLabel>Password</ListItemLabel>
            <ListItemValue>••••••••</ListItemValue>
          </ListItemButton>
          <ListItemButton id="delete-account" onClick={() => setDeleteAccountOpen(true)}>
            <span className="text-xs text-red-600">Delete account</span>
          </ListItemButton>
        </List>
      </div>

      <div className="flex flex-col gap-2">
        <Heading2>Passkeys</Heading2>
        <Copy className="text-xs">Manage passkeys for passwordless sign-in.</Copy>
        <List>
          {MOCK_PASSKEYS.map((passkey) => (
            <ListItemButton key={passkey.id} id={passkey.id} onClick={() => setDeletePasskeyOpen(passkey)}>
              <div className="flex items-center gap-2">
                <Fingerprint size={14} className="text-neutral-400" />
                <ListItemLabel>{passkey.name}</ListItemLabel>
              </div>
              <ListItemValue>Added {formatDate(passkey.createdAt)}</ListItemValue>
            </ListItemButton>
          ))}
          <ListItemAdd>Add passkey</ListItemAdd>
        </List>
      </div>

      <Modal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)}>
        <ModalHeader
          title="Change password"
          description="Enter your current password and a new password."
        />
        <ModalContent>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Current password</label>
            <Input inputSize="small" type="password" placeholder="••••••••" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">New password</label>
            <Input inputSize="small" type="password" placeholder="••••••••" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Confirm new password</label>
            <Input inputSize="small" type="password" placeholder="••••••••" />
          </div>
        </ModalContent>
        <ModalFooter
          onCancel={() => setChangePasswordOpen(false)}
          onConfirm={() => setChangePasswordOpen(false)}
          confirmText="Change password"
        />
      </Modal>

      <Modal open={deleteAccountOpen} onClose={() => setDeleteAccountOpen(false)}>
        <ModalHeader
          title="Delete account"
          description="Are you sure you want to delete your account? This action cannot be undone."
        />
        <ModalContent>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Enter your password to confirm</label>
            <Input inputSize="small" type="password" placeholder="••••••••" />
          </div>
        </ModalContent>
        <ModalFooter
          onCancel={() => setDeleteAccountOpen(false)}
          onConfirm={() => setDeleteAccountOpen(false)}
          confirmText="Delete account"
          variant="danger"
        />
      </Modal>

      <Modal open={deletePasskeyOpen !== null} onClose={() => setDeletePasskeyOpen(null)}>
        <ModalHeader
          title="Delete passkey"
          description={`Are you sure you want to delete "${deletePasskeyOpen?.name}"? You will no longer be able to sign in with this passkey.`}
        />
        <ModalFooter
          onCancel={() => setDeletePasskeyOpen(null)}
          onConfirm={() => setDeletePasskeyOpen(null)}
          confirmText="Delete passkey"
          variant="danger"
        />
      </Modal>
    </div>
  );
};

export default SettingsPage;
