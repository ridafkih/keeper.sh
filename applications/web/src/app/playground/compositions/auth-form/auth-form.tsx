import { AuthFormProvider } from "./contexts/auth-form-context";
import { AuthForm as AuthFormInner } from "./components/auth-form";

interface AuthFormProps {
  variant: "login" | "register";
}

export const AuthForm = ({ variant }: AuthFormProps) => (
  <AuthFormProvider>
    <AuthFormInner variant={variant} />
  </AuthFormProvider>
);
