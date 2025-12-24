"use client";

import { useState, useEffect } from "react";
import { Toast } from "@base-ui/react/toast";
import { TextLabel, TextBody } from "@/components/typography";

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="bg-white border border-zinc-200 rounded-lg shadow-lg p-4 data-starting-style:opacity-0 data-starting-style:translate-y-2 data-ending-style:opacity-0 data-ending-style:translate-y-2 transition-all duration-200"
    >
      <Toast.Title render={<TextLabel />}>{toast.title}</Toast.Title>
      {toast.description && (
        <Toast.Description render={<TextBody className="mt-0.5" />}>
          {toast.description}
        </Toast.Description>
      )}
    </Toast.Root>
  ));
}

function ToastViewport() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 w-80">
        <ToastList />
      </Toast.Viewport>
    </Toast.Portal>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider timeout={3000}>
      {children}
      <ToastViewport />
    </Toast.Provider>
  );
}

export { Toast };
