import { AuthFormProvider } from "./contexts/auth-form-context";
import { AuthForm as AuthFormInner } from "./components/auth-form";

interface AuthFormProps {
  variant: "login" | "register";
  strategy: "commercial" | "non-commercial";
}

export const AuthForm = ({ variant, strategy }: AuthFormProps) => (
  <AuthFormProvider>
    <AuthFormInner variant={variant} strategy={strategy} />
  </AuthFormProvider>
);
