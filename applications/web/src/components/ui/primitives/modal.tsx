import type { PropsWithChildren } from "react";
import { createContext, use, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSetAtom } from "jotai";
import { Heading3 } from "./heading";
import { Text } from "./text";
import { popoverOverlayAtom } from "../../../state/popover-overlay";

interface ModalContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

function useModal() {
  const ctx = use(ModalContext);
  if (!ctx) throw new Error("Modal subcomponents must be used within <Modal>");
  return ctx;
}

interface ModalProps extends PropsWithChildren {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Modal({ children, open: controlledOpen, onOpenChange }: ModalProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (value: boolean) => {
    onOpenChange?.(value);
    if (controlledOpen === undefined) setUncontrolledOpen(value);
  };

  return (
    <ModalContext value={{ open, setOpen }}>
      {children}
    </ModalContext>
  );
}

export function ModalContent({ children }: PropsWithChildren) {
  const { open, setOpen } = useModal();
  const contentRef = useRef<HTMLDivElement>(null);
  const setOverlay = useSetAtom(popoverOverlayAtom);

  useEffect(() => {
    if (!open) return;
    setOverlay(true);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      setOverlay(false);
    };
  }, [open, setOpen, setOverlay]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      onClick={(event) => {
        if (!(event.target instanceof Node)) return;
        if (contentRef.current && !contentRef.current.contains(event.target)) {
          setOpen(false);
        }
      }}
    >
      <div
        ref={contentRef}
        className="flex flex-col gap-3 bg-background-elevated border border-border-elevated rounded-2xl shadow-xs p-4 max-w-sm w-full overflow-hidden"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalTitle({ children }: PropsWithChildren) {
  return <Heading3 className="truncate">{children}</Heading3>;
}

export function ModalDescription({ children }: PropsWithChildren) {
  return <Text size="sm" tone="muted" align="left">{children}</Text>;
}

export function ModalFooter({ children }: PropsWithChildren) {
  return <div className="flex flex-col gap-1.5">{children}</div>;
}
