import { AuthFormProvider } from "./contexts/auth-form-context";
import { AuthForm as AuthFormSansProvider } from "./components/auth-form";

interface AuthFormProps {
  variant: "login" | "register";
  strategy: "commercial" | "non-commercial";
}

const AuthForm = ({ variant, strategy }: AuthFormProps) => (
  <AuthFormProvider>
    <AuthFormSansProvider variant={variant} strategy={strategy} />
  </AuthFormProvider>
);

export { AuthForm }
