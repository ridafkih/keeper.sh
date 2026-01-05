import type { ReactNode } from "react";
import { AuthFormContainer } from "@/components/auth-form";
import { CompleteRegistrationForm } from "./form";

const CompleteRegistrationPage = (): ReactNode => (
  <AuthFormContainer>
    <CompleteRegistrationForm />
  </AuthFormContainer>
);

export default CompleteRegistrationPage;
