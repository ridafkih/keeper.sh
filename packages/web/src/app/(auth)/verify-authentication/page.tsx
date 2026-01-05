"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { AuthFormContainer } from "@/components/auth-form";

export default function VerifyAuthenticationPage(): ReactNode {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && user) {
      router.replace("/dashboard");
    }
  }, [user, isLoading, router]);

  return (
    <AuthFormContainer>
      <div className="w-full max-w-xs p-4 rounded-md bg-surface text-center">
        <p className="text-sm text-foreground-muted">Redirecting...</p>
      </div>
    </AuthFormContainer>
  );
}
