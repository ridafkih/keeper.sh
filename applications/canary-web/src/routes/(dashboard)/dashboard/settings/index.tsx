import { useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRound, Lock, Mail, Trash2 } from "lucide-react";
import { Button, ButtonText } from "../../../../components/ui/button";
import { BackButton } from "../../../../components/ui/back-button";
import { useSession } from "../../../../hooks/use-session";
import { usePasskeys } from "../../../../hooks/use-passkeys";
import { Input } from "../../../../components/ui/input";
import { deleteAccount } from "../../../../lib/auth";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalTitle,
} from "../../../../components/ui/modal";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "../../../../components/ui/navigation-menu";
import { Text } from "../../../../components/ui/text";

export const Route = createFileRoute("/(dashboard)/dashboard/settings/")({
  component: SettingsPage,
});

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

function pluralizePasskeys(count: number): string {
  if (count === 1) return "passkey";
  return "passkeys";
}

function SettingsPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const passwordRef = useRef<HTMLInputElement>(null);
  const email = user?.email ?? "";
  const { data: passkeys = [] } = usePasskeys();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteAccount = async () => {
    const password = passwordRef.current?.value;
    if (!password) return;
    setDeleteError(null);
    try {
      await deleteAccount(password);
      setDeleteOpen(false);
      navigate({ to: "/login" });
    } catch (err) {
      setDeleteError(resolveErrorMessage(err, "Failed to delete account."));
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton />
      <NavigationMenu>
        <NavigationMenuItem>
          <NavigationMenuItemIcon>
            <Mail size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Email</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            <Text size="sm" tone="muted" className="truncate">{email}</Text>
          </NavigationMenuItemTrailing>
        </NavigationMenuItem>
      </NavigationMenu>
      <NavigationMenu>
        <NavigationMenuItem to="/dashboard/settings/change-password">
          <NavigationMenuItemIcon>
            <Lock size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Change Password</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing />
        </NavigationMenuItem>
        <NavigationMenuItem to="/dashboard/settings/passkeys">
          <NavigationMenuItemIcon>
            <KeyRound size={15} />
          </NavigationMenuItemIcon>
          <NavigationMenuItemLabel>Passkeys</NavigationMenuItemLabel>
          <NavigationMenuItemTrailing>
            <Text size="sm" tone="muted">
              {passkeys.length} {pluralizePasskeys(passkeys.length)}
            </Text>
          </NavigationMenuItemTrailing>
        </NavigationMenuItem>
      </NavigationMenu>
      <NavigationMenu>
        <NavigationMenuItem onClick={() => setDeleteOpen(true)}>
          <NavigationMenuItemIcon>
            <Trash2 size={15} className="text-destructive" />
          </NavigationMenuItemIcon>
          <Text size="sm" tone="danger">Delete Account</Text>
        </NavigationMenuItem>
      </NavigationMenu>
      <Modal open={deleteOpen} onOpenChange={setDeleteOpen}>
        <ModalContent>
          <ModalTitle>Delete account?</ModalTitle>
          <ModalDescription>
            This action is permanent and cannot be undone. All of your data, calendars, and connected accounts will be permanently deleted.
          </ModalDescription>
          <Input ref={passwordRef} type="password" placeholder="Confirm your password" />
          {deleteError && <Text size="sm" tone="danger">{deleteError}</Text>}
          <ModalFooter>
            <Button variant="destructive" className="w-full justify-center" onClick={handleDeleteAccount}>
              <ButtonText>Delete my account</ButtonText>
            </Button>
            <Button variant="elevated" className="w-full justify-center" onClick={() => setDeleteOpen(false)}>
              <ButtonText>Cancel</ButtonText>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
