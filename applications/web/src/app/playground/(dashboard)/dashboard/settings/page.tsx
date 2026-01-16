"use client";

import { useState } from "react";
import { Fingerprint } from "lucide-react";
import {
  Copy,
  Input,
  Heading1,
  Heading2,
  Divider,
  Modal,
  ModalHeader,
  ModalContent,
  ModalFooter,
  List,
  ListItem,
  ListItemButton,
  ListItemLabel,
  ListItemValue,
  ListItemAdd,
  SectionHeader
} from "@keeper.sh/ui";

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

const formatDate = (date: Date): string =>
  date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const SettingsPage = () => {
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deletePasskeyOpen, setDeletePasskeyOpen] = useState<Passkey | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <div className="md:hidden">
        <Heading1>Settings</Heading1>
      </div>
      <div className="flex flex-col gap-2">
        <SectionHeader
          title="Account"
          description="Manage your account settings."
        />
        <List>
          <ListItem id="email">
            <div className="flex items-center justify-between px-4 py-2">
              <ListItemLabel>Email</ListItemLabel>
              <ListItemValue>john@example.com</ListItemValue>
            </div>
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
        <SectionHeader
          title="Passkeys"
          description="Manage passkeys for passwordless sign-in."
        />
        <List>
          {MOCK_PASSKEYS.map((passkey) => (
            <ListItemButton key={passkey.id} id={passkey.id} onClick={() => setDeletePasskeyOpen(passkey)}>
              <div className="flex items-center gap-2">
                <Fingerprint size={14} className="text-foreground-subtle" />
                <ListItemLabel>{passkey.name}</ListItemLabel>
              </div>
              <ListItemValue>Added {formatDate(passkey.createdAt)}</ListItemValue>
            </ListItemButton>
          ))}
          <ListItemAdd>Add passkey</ListItemAdd>
        </List>
      </div>

      <Modal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)}>
        <form onSubmit={(e) => { e.preventDefault(); setChangePasswordOpen(false); }}>
          <ModalHeader
            title="Change password"
            description="Enter your current password and a new password."
            onClose={() => setChangePasswordOpen(false)}
          />
          <ModalContent>
            <Input size="small" type="password" placeholder="Current password" name="current-password" />
            <Divider />
            <Input size="small" type="password" placeholder="New password" name="new-password" />
            <Input size="small" type="password" placeholder="Confirm new password" name="confirm-password" />
          </ModalContent>
          <ModalFooter
            onCancel={() => setChangePasswordOpen(false)}
            onConfirm={() => setChangePasswordOpen(false)}
            confirmText="Change password"
            isForm
          />
        </form>
      </Modal>

      <Modal open={deleteAccountOpen} onClose={() => setDeleteAccountOpen(false)}>
        <form onSubmit={(e) => { e.preventDefault(); setDeleteAccountOpen(false); }}>
          <ModalHeader
            title="Delete account"
            description="Are you sure you want to delete your account? This action cannot be undone."
            onClose={() => setDeleteAccountOpen(false)}
          />
          <ModalContent>
            <Input size="small" type="password" placeholder="Enter your password to confirm" name="password" />
          </ModalContent>
          <ModalFooter
            onCancel={() => setDeleteAccountOpen(false)}
            onConfirm={() => setDeleteAccountOpen(false)}
            confirmText="Delete account"
            variant="danger"
            isForm
          />
        </form>
      </Modal>

      <Modal open={deletePasskeyOpen !== null} onClose={() => setDeletePasskeyOpen(null)}>
        <ModalHeader
          title="Delete passkey"
          description={`Are you sure you want to delete "${deletePasskeyOpen?.name}"? You will no longer be able to sign in with this passkey.`}
          onClose={() => setDeletePasskeyOpen(null)}
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
