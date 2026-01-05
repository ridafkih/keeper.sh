"use client";

import type { FC, PropsWithChildren } from "react";
import { useEffect, useState } from "react";
import { Toast } from "@base-ui/react/toast";
import { TextBody, TextLabel } from "@/components/typography";
import { TOAST_TIMEOUT_MS } from "@keeper.sh/constants";

const ToastList: FC = () => {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="bg-surface-elevated border border-border rounded-lg shadow-lg p-4 data-starting-style:opacity-0 data-starting-style:translate-y-2 data-ending-style:opacity-0 data-ending-style:translate-y-2 transition-all duration-200"
    >
      <Toast.Title render={<TextLabel />}>{toast.title}</Toast.Title>
      {toast.description && (
        <Toast.Description render={<TextBody className="mt-0.5" />}>
          {toast.description}
        </Toast.Description>
      )}
    </Toast.Root>
  ));
};

const ToastViewport: FC = () => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return;
  }

  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 w-80">
        <ToastList />
      </Toast.Viewport>
    </Toast.Portal>
  );
};

const ToastProvider: FC<PropsWithChildren> = ({ children }) => (
  <Toast.Provider timeout={TOAST_TIMEOUT_MS}>
    {children}
    <ToastViewport />
  </Toast.Provider>
);

export { ToastProvider, Toast };
