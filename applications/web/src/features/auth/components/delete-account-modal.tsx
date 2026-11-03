import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { Input } from "@/components/ui/primitives/input";
import { Text } from "@/components/ui/primitives/text";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalTitle,
} from "@/components/ui/primitives/modal";
import { deleteAccount, reauthenticate } from "@/lib/auth";
import { resolveReauthenticationMethods } from "@/lib/account-reauthentication";
import type { ReauthenticationMethod } from "@/lib/account-reauthentication";
import { resolveOidcProviderName } from "@/lib/auth-capabilities";
import type { AuthCapabilities } from "@/lib/auth-capabilities";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { resolveErrorMessage } from "@/utils/errors";
import type { SessionUser } from "@/hooks/use-session";

type DeleteAccountStep = "confirm" | "reauthenticate";

interface DeleteAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: SessionUser | null;
  capabilities: AuthCapabilities;
  hasPassword: boolean;
  linkedProviderIds: string[];
  passkeyCount: number;
}

const methodKey = (method: ReauthenticationMethod): string => {
  if (method.kind === "passkey") return "passkey";
  return method.provider;
};

const resolveMethodLabel = (
  method: ReauthenticationMethod,
  capabilities: AuthCapabilities,
): string => {
  if (method.kind === "passkey") return "Confirm with passkey";
  if (method.provider === "google") return "Continue with Google";
  if (method.provider === "microsoft") return "Continue with Outlook";
  return `Continue with ${resolveOidcProviderName(capabilities)}`;
};

const resolveDescription = (step: DeleteAccountStep): string => {
  if (step === "reauthenticate") {
    return "Sign in again to confirm it's you, then delete your account.";
  }
  return "This action is permanent and cannot be undone. All of your data, calendars, and connected accounts will be permanently deleted.";
};

export function DeleteAccountModal({
  open,
  onOpenChange,
  user,
  capabilities,
  hasPassword,
  linkedProviderIds,
  passkeyCount,
}: DeleteAccountModalProps) {
  const navigate = useNavigate();
  const passwordRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<DeleteAccountStep>("confirm");
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const methods = resolveReauthenticationMethods({
    capabilities,
    linkedProviderIds,
    passkeyCount,
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setStep("confirm");
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  const runDeletion = async () => {
    const password = hasPassword ? passwordRef.current?.value : undefined;
    if (hasPassword && !password) return;
    const outcome = await deleteAccount(password);
    if (outcome === "reauthentication-required") {
      setStep("reauthenticate");
      return;
    }
    track(ANALYTICS_EVENTS.account_deleted);
    onOpenChange(false);
    navigate({ to: "/login" });
  };

  const runSafely = async (work: () => Promise<void>, fallback: string) => {
    setError(null);
    setIsWorking(true);
    try {
      await work();
    } catch (err) {
      setError(resolveErrorMessage(err, fallback));
    } finally {
      setIsWorking(false);
    }
  };

  const handleDelete = () => runSafely(runDeletion, "Failed to delete account.");

  const handleReauthenticate = (method: ReauthenticationMethod) =>
    runSafely(async () => {
      if (!user) return;
      await reauthenticate(method, user);
      if (method.kind === "passkey") {
        setStep("confirm");
        await runDeletion();
      }
    }, "Couldn't confirm it's you.");

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalContent>
        <ModalTitle>Delete account?</ModalTitle>
        <ModalDescription>{resolveDescription(step)}</ModalDescription>
        {step === "confirm" && hasPassword && (
          <Input ref={passwordRef} type="password" placeholder="Confirm your password" />
        )}
        {step === "reauthenticate" && methods.length === 0 && (
          <Text size="sm" tone="muted">Sign out, sign back in, and then delete your account.</Text>
        )}
        {error && <Text size="sm" tone="danger">{error}</Text>}
        <ModalFooter>
          {step === "confirm" && (
            <Button variant="destructive" className="w-full justify-center" onClick={handleDelete} disabled={isWorking}>
              <ButtonText>{isWorking ? "Deleting..." : "Delete my account"}</ButtonText>
            </Button>
          )}
          {step === "reauthenticate" && methods.map((method) => (
            <Button
              key={methodKey(method)}
              variant="border"
              className="w-full justify-center"
              onClick={() => handleReauthenticate(method)}
              disabled={isWorking}
            >
              <ButtonText>{resolveMethodLabel(method, capabilities)}</ButtonText>
            </Button>
          ))}
          <Button variant="elevated" className="w-full justify-center" onClick={() => handleOpenChange(false)}>
            <ButtonText>Cancel</ButtonText>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
