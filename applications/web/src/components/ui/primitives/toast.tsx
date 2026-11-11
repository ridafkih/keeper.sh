import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useAtomValue, useSetAtom } from "jotai";
import { AnimatePresence, LazyMotion } from "motion/react";
import * as m from "motion/react-m";
import { loadMotionFeatures } from "@/lib/motion-features";
import { dismissToastAtom, toastAtom } from "@/state/toast";
import type { Toast } from "@/state/toast";
import { Text } from "./text";

const TOAST_DURATION_MS = 3000;
const TOAST_HIDDEN = { opacity: 0, y: -8, filter: "blur(4px)" };
const TOAST_VISIBLE = { opacity: 1, y: 0, filter: "blur(0px)" };

export function Toaster() {
  const toast = useAtomValue(toastAtom);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4" role="status" aria-live="polite">
      <LazyMotion features={loadMotionFeatures}>
        <AnimatePresence>
          {toast && <ToastMessage key={toast.id} toast={toast} />}
        </AnimatePresence>
      </LazyMotion>
    </div>,
    document.body,
  );
}

function ToastMessage({ toast }: { toast: Toast }) {
  const dismiss = useSetAtom(dismissToastAtom);

  useEffect(() => {
    const timeout = setTimeout(() => dismiss(toast.id), TOAST_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [dismiss, toast.id]);

  return (
    <m.div
      className="rounded-full bg-background-inverse px-3.5 py-1.5 shadow-lg"
      initial={TOAST_HIDDEN}
      animate={TOAST_VISIBLE}
      exit={TOAST_HIDDEN}
      transition={{ duration: 0.2 }}
    >
      <Text as="span" size="sm" tone="inverse">{toast.message}</Text>
    </m.div>
  );
}
