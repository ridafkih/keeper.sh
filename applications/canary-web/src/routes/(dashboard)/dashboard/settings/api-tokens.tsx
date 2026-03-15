import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import Check from "lucide-react/dist/esm/icons/check";
import Copy from "lucide-react/dist/esm/icons/copy";
import KeySquare from "lucide-react/dist/esm/icons/key-square";
import Plus from "lucide-react/dist/esm/icons/plus";
import { Button, ButtonIcon, ButtonText } from "../../../../components/ui/primitives/button";
import { BackButton } from "../../../../components/ui/primitives/back-button";
import { Input } from "../../../../components/ui/primitives/input";
import {
  useApiTokens,
  createApiToken,
  deleteApiToken,
} from "../../../../hooks/use-api-tokens";
import type { ApiToken } from "../../../../hooks/use-api-tokens";
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

export const Route = createFileRoute(
  "/(dashboard)/dashboard/settings/api-tokens",
)({
  component: ApiTokensPage,
});

function CopyTokenIcon({ copied }: { copied: boolean }) {
  if (copied) {
    return <Check size={16} />;
  }
  return <Copy size={16} />;
}

function ApiTokensPage() {
  const { data: tokens = [], error, mutate } = useApiTokens();
  const [deleteTarget, setDeleteTarget] = useState<ApiToken | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    setMutationError(null);
    try {
      await mutate(
        async (current) => {
          await deleteApiToken(targetId);
          return current?.filter((entry) => entry.id !== targetId) ?? [];
        },
        {
          optimisticData: tokens.filter((entry) => entry.id !== targetId),
          rollbackOnError: true,
          revalidate: false,
        },
      );
    } catch (err) {
      setMutationError(resolveErrorMessage(err, "Failed to delete token."));
    }
  };

  const handleCopy = async () => {
    if (!revealedToken) return;
    await navigator.clipboard.writeText(revealedToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCloseReveal = () => {
    setRevealedToken(null);
    setCopied(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <BackButton fallback="/dashboard/settings" />
      {error && (
        <ErrorState message="Failed to load API tokens." onRetry={() => mutate()} />
      )}
      {mutationError && <Text size="sm" tone="danger">{mutationError}</Text>}
      <NavigationMenu>
        {tokens.map((token) => (
          <NavigationMenuButtonItem
            key={token.id}
            onClick={() => setDeleteTarget(token)}
          >
            <NavigationMenuItemIcon>
              <KeySquare size={15} />
            </NavigationMenuItemIcon>
            <NavigationMenuItemLabel>{token.name}</NavigationMenuItemLabel>
            <NavigationMenuItemTrailing>
              <Text size="sm" tone="muted">
                {token.tokenPrefix}...
              </Text>
            </NavigationMenuItemTrailing>
          </NavigationMenuButtonItem>
        ))}
        <CreateTokenButton
          onCreated={(plainToken) => {
            setRevealedToken(plainToken);
            mutate();
          }}
          onError={setMutationError}
          createOpen={createOpen}
          setCreateOpen={setCreateOpen}
        />
      </NavigationMenu>
      <Modal
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <ModalContent>
          <ModalTitle>Delete token?</ModalTitle>
          <ModalDescription>
            This will permanently revoke "{deleteTarget?.name}". Any scripts or
            integrations using this token will stop working.
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
      <Modal open={!!revealedToken} onOpenChange={(open) => {
        if (!open) handleCloseReveal();
      }}>
        <ModalContent>
          <ModalTitle>Token created</ModalTitle>
          <ModalDescription>
            Copy your token now. You won't be able to see it again.
          </ModalDescription>
          <div className="flex gap-1.5">
            <Input
              readOnly
              value={revealedToken ?? ""}
              className="text-sm"
            />
            <Button
              variant="border"
              className="shrink-0 aspect-square"
              onClick={handleCopy}
              disabled={!revealedToken}
            >
              <ButtonIcon>
                <CopyTokenIcon copied={copied} />
              </ButtonIcon>
            </Button>
          </div>
          <ModalFooter>
            <Button variant="elevated" className="w-full justify-center" onClick={handleCloseReveal}>
              <ButtonText>Done</ButtonText>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

function CreateSubmitButton({ isCreating }: { isCreating: boolean }) {
  if (isCreating) {
    return (
      <Button type="submit" className="w-full justify-center" disabled>
        <ButtonText>Creating...</ButtonText>
      </Button>
    );
  }

  return (
    <Button type="submit" className="w-full justify-center">
      <ButtonText>Create</ButtonText>
    </Button>
  );
}

function CreateTokenButton({
  onCreated,
  onError,
  createOpen,
  setCreateOpen,
}: {
  onCreated: (plainToken: string) => void;
  onError: (error: string | null) => void;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = nameRef.current?.value?.trim();
    if (!name) return;
    onError(null);
    setIsCreating(true);
    try {
      const result = await createApiToken(name);
      setCreateOpen(false);
      onCreated(result.token);
    } catch (err) {
      onError(resolveErrorMessage(err, "Failed to create token."));
      setCreateOpen(false);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <NavigationMenuButtonItem onClick={() => setCreateOpen(true)}>
        <NavigationMenuItemIcon>
          <Plus size={15} />
        </NavigationMenuItemIcon>
        <NavigationMenuItemLabel>Create Token</NavigationMenuItemLabel>
      </NavigationMenuButtonItem>
      <Modal open={createOpen} onOpenChange={setCreateOpen}>
        <ModalContent>
          <form onSubmit={handleSubmit} className="contents">
            <ModalTitle>Create API token</ModalTitle>
            <ModalDescription>
              Give your token a name to help you remember what it's used for.
            </ModalDescription>
            <Input ref={nameRef} name="name" placeholder="Token name" autoFocus />
            <ModalFooter>
              <CreateSubmitButton isCreating={isCreating} />
              <Button type="button" variant="elevated" className="w-full justify-center" onClick={() => setCreateOpen(false)}>
                <ButtonText>Cancel</ButtonText>
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </>
  );
}
