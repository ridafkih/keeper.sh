import { useRef, useState } from "react";
import { useSWRConfig } from "swr";
import type { SyncRule } from "@keeper.sh/data-schemas";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { Input } from "@/components/ui/primitives/input";
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalTitle,
} from "@/components/ui/primitives/modal";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import { useMutateEntitlements } from "@/hooks/use-entitlements";
import { resolveErrorMessage } from "@/utils/errors";
import { createRule, RULES_KEY } from "../use-rules";

interface CreateRuleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (rule: SyncRule) => Promise<void> | void;
  onError: (message: string | null) => void;
}

function SubmitButton({ creating }: { creating: boolean }) {
  if (creating) {
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

export function CreateRuleModal({ open, onOpenChange, onCreated, onError }: CreateRuleModalProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const { mutate } = useSWRConfig();
  const { revalidateEntitlements } = useMutateEntitlements();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = nameRef.current?.value.trim();
    if (!name) return;
    onError(null);
    setCreating(true);
    try {
      const created = await createRule(name);
      track(ANALYTICS_EVENTS.rule_created);
      onOpenChange(false);
      await Promise.all([mutate(RULES_KEY), revalidateEntitlements()]);
      await onCreated(created);
    } catch (error) {
      onError(resolveErrorMessage(error, "Failed to create rule."));
      onOpenChange(false);
      await revalidateEntitlements();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <form onSubmit={handleSubmit} className="contents">
          <ModalTitle>New rule</ModalTitle>
          <ModalDescription>
            Name it after what it does, like &quot;Hide standups&quot;. You choose what it matches next.
          </ModalDescription>
          <Input ref={nameRef} name="name" placeholder="Rule name" autoFocus />
          <ModalFooter>
            <SubmitButton creating={creating} />
            <Button type="button" variant="elevated" className="w-full justify-center" onClick={() => onOpenChange(false)}>
              <ButtonText>Cancel</ButtonText>
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
