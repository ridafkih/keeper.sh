import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { Modal, ModalContent, ModalDescription, ModalFooter, ModalTitle } from "@/components/ui/primitives/modal";
import { Text } from "@/components/ui/primitives/text";

interface SaveSyncConfirmationProps {
  changes: string[];
  // Which copies the save deletes, one line each.
  removals: string[];
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function SaveSyncConfirmation({ changes, removals, open, saving, onOpenChange, onConfirm }: SaveSyncConfirmationProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>Save these changes?</ModalTitle>
        <ul className="flex flex-col gap-1">
          {changes.map((change) => (
            <li key={change}>
              <Text size="sm" tone="default">{change}</Text>
            </li>
          ))}
        </ul>
        {removals.length > 0 && (
          <div className="flex flex-col gap-1">
            <Text size="sm" tone="default" className="font-medium">Copies this removes</Text>
            <ul className="flex flex-col gap-1">
              {removals.map((removal) => (
                <li key={removal}>
                  <Text size="sm" tone="muted">{removal}</Text>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ModalDescription>The original events aren't touched.</ModalDescription>
        <ModalFooter>
          <Button className="w-full justify-center" onClick={onConfirm} disabled={saving}>
            {saving && <LoaderCircle size={16} className="animate-spin" />}
            <ButtonText>{saving ? "Saving..." : "Save"}</ButtonText>
          </Button>
          <Button variant="elevated" className="w-full justify-center" onClick={() => onOpenChange(false)}>
            <ButtonText>Cancel</ButtonText>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

interface DiscardChangesConfirmationProps {
  open: boolean;
  description?: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
}

export function DiscardChangesConfirmation({
  open,
  description = "Your edits to this sync haven't been saved.",
  onKeepEditing,
  onDiscard,
}: DiscardChangesConfirmationProps) {
  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) onKeepEditing(); }}>
      <ModalContent>
        <ModalTitle>Discard unsaved changes?</ModalTitle>
        <ModalDescription>{description}</ModalDescription>
        <ModalFooter>
          <Button variant="destructive" className="w-full justify-center" onClick={onDiscard}>
            <ButtonText>Discard</ButtonText>
          </Button>
          <Button variant="elevated" className="w-full justify-center" onClick={onKeepEditing}>
            <ButtonText>Keep Editing</ButtonText>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
