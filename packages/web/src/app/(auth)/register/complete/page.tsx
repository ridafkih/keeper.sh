import type { ReactNode } from "react";
import { AuthFormContainer } from "@/components/auth-form";
import { CompleteRegistrationForm } from "./form";

export default function CompleteRegistrationPage(): ReactNode {
  return (
    <AuthFormContainer>
      <CompleteRegistrationForm />
    </AuthFormContainer>
  );
}
