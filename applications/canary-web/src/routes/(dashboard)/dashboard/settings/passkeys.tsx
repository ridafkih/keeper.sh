import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, KeyRound, Plus } from "lucide-react";
import useSWR from "swr";
import { LinkButton, Button, ButtonIcon, ButtonText } from "../../../../components/ui/button";
import { authClient } from "../../../../lib/auth-client";
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
import { ErrorState } from "../../../../components/ui/error-state";
import { Text } from "../../../../components/ui/text";

export const Route = createFileRoute(
  "/(dashboard)/dashboard/settings/passkeys",
)({
  component: RouteComponent,
});

interface Passkey {
  id: string;
  name?: string | null;
  createdAt: Date;
}

const fetchPasskeys = async (): Promise<Passkey[]> => {
  const { data } = await authClient.passkey.listUserPasskeys();
  return data ?? [];
};

function RouteComponent() {
  const { data: passkeys = [], error, mutate } = useSWR("auth/passkeys", fetchPasskeys);
  const [deleteTarget, setDeleteTarget] = useState<Passkey | null>(null);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    await mutate(
      async (current) => {
        await authClient.passkey.deletePasskey({ id: targetId });
        return current?.filter((p) => p.id !== targetId) ?? [];
      },
      {
        optimisticData: passkeys.filter((p) => p.id !== targetId),
        rollbackOnError: true,
        revalidate: false,
      },
    );
  };

  const handleAdd = async () => {
    await authClient.passkey.addPasskey();
    await mutate();
  };

  const formatDate = (date: Date) =>
    new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="flex flex-col gap-1.5">
      <LinkButton to="/dashboard/settings" variant="elevated" size="compact" className="aspect-square">
        <ButtonIcon>
          <ArrowLeft size={16} />
        </ButtonIcon>
      </LinkButton>
      {error && <ErrorState message="Failed to load passkeys." onRetry={() => mutate()} />}
      <NavigationMenu>
        {passkeys.map((passkey) => (
          <NavigationMenuItem key={passkey.id} onClick={() => setDeleteTarget(passkey)}>
            <NavigationMenuItemIcon>
              <KeyRound size={15} />
              <NavigationMenuItemLabel>{passkey.name ?? "Passkey"}</NavigationMenuItemLabel>
            </NavigationMenuItemIcon>
            <NavigationMenuItemTrailing>
              <Text size="sm" tone="muted">{formatDate(passkey.createdAt)}</Text>
            </NavigationMenuItemTrailing>
          </NavigationMenuItem>
        ))}
        <NavigationMenuItem onClick={handleAdd}>
          <NavigationMenuItemIcon>
            <Plus size={15} />
            <NavigationMenuItemLabel>Add Passkey</NavigationMenuItemLabel>
          </NavigationMenuItemIcon>
        </NavigationMenuItem>
      </NavigationMenu>
      <Modal open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <ModalContent>
          <ModalTitle>Delete passkey?</ModalTitle>
          <ModalDescription>
            This will remove "{deleteTarget?.name ?? "Passkey"}" from your account. You won't be able to use it to sign in anymore.
          </ModalDescription>
          <ModalFooter>
            <Button variant="destructive" className="w-full justify-center" onClick={handleDelete}>
              <ButtonText>Delete</ButtonText>
            </Button>
            <Button variant="elevated" className="w-full justify-center" onClick={() => setDeleteTarget(null)}>
              <ButtonText>Cancel</ButtonText>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
