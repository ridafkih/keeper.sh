import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import KeyRound from "lucide-react/dist/esm/icons/key-round";
import Plus from "lucide-react/dist/esm/icons/plus";
import { Button, ButtonText } from "../../../../components/ui/primitives/button";
import { BackButton } from "../../../../components/ui/primitives/back-button";
import { usePasskeys, addPasskey, deletePasskey } from "../../../../hooks/use-passkeys";
import type { Passkey } from "../../../../hooks/use-passkeys";
import { formatDateShort } from "../../../../lib/time";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalTitle,
} from "../../../../components/ui/primitives/modal";
import {
  NavigationMenu,
  NavigationMenuButtonItem,
  NavigationMenuItemIcon,
  NavigationMenuItemLabel,
  NavigationMenuItemTrailing,
} from "../../../../components/ui/composites/navigation-menu/navigation-menu-items";
import { ErrorState } from "../../../../components/ui/primitives/error-state";
import { Text } from "../../../../components/ui/primitives/text";
import { resolveErrorMessage } from "../../../../utils/errors";
import { fetchAuthCapabilitiesWithApi } from "../../../../lib/auth-capabilities";

export const Route = createFileRoute(
  "/(dashboard)/dashboard/settings/passkeys",
)({
  loader: async ({ context }) => {
    const capabilities = await fetchAuthCapabilitiesWithApi(context.fetchApi);
    if (!capabilities.supportsPasskeys) {
      throw redirect({ to: "/dashboard/settings" });
    }
    return capabilities;
  },
  component: PasskeysPage,
});

function PasskeysPage() {
  const { data: passkeys = [], error, mutate } = usePasskeys();
  const [deleteTarget, setDeleteTarget] = useState<Passkey | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    setMutationError(null);
    try {
      await mutate(
        async (current) => {
          await deletePasskey(targetId);
          return current?.filter((entry) => entry.id !== targetId) ?? [];
        },
        {
          optimisticData: passkeys.filter((entry) => entry.id !== targetId),
          rollbackOnError: true,
          revalidate: false,
        },
      );
    } catch (err) {
      setMutationError(resolveErrorMessage(err, "Failed to delete passkey."));
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback="/dashboard/settings" />
      {error && <ErrorState message="Failed to load passkeys." onRetry={() => mutate()} />}
      {mutationError && <Text size="sm" tone="danger">{mutationError}</Text>}
      <NavigationMenu>
        {passkeys.map((passkey) => (
          <NavigationMenuButtonItem key={passkey.id} onClick={() => setDeleteTarget(passkey)}>
            <NavigationMenuItemIcon>
              <KeyRound size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>{passkey.name ?? "Passkey"}</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing>
              <Text size="sm" tone="muted">{formatDateShort(passkey.createdAt)}</Text>
            </NavigationMenuItemTrailing>
          </NavigationMenuButtonItem>
        ))}
        <AddPasskeyButton mutate={mutate} onError={setMutationError} />
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

function AddPasskeyButton({
  mutate,
  onError,
}: {
  mutate: ReturnType<typeof usePasskeys>["mutate"];
  onError: (error: string | null) => void;
}) {
  const [isMutating, setIsMutating] = useState(false);

  const handleAdd = async () => {
    onError(null);
    setIsMutating(true);
    try {
      await addPasskey();
      await mutate();
    } catch (err) {
      onError(resolveErrorMessage(err, "Failed to add passkey."));
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <NavigationMenuButtonItem onClick={isMutating ? undefined : handleAdd} disabled={isMutating}>
      <NavigationMenuItemIcon>
        <Plus size={15} />
      </NavigationMenuItemIcon>
      <NavigationMenuItemLabel>{isMutating ? "Working..." : "Add Passkey"}</NavigationMenuItemLabel>
    </NavigationMenuButtonItem>
  );
}
