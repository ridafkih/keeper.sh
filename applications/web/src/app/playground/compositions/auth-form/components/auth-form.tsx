"use client";

import type { FC, FormEvent, HTMLInputAutoCompleteAttribute} from "react";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Provider, useStore } from "jotai";
import { FormDivider } from "../../../components/form-divider";
import { GoogleIcon } from "@/components/icons/google";
import {
  showPasswordFieldAtom,
  useSetShowPasswordField,
  useSetIsLoading,
  useIsLoading,
} from "../contexts/auth-form-context";
import { EmailField } from "./email-field";
import { PasswordField } from "./password-field";
import { UsernameField } from "./username-field";
import { SubmitButton } from "./submit-button";
import { OAuthButton } from "./oauth-button";
import { IconButton } from "@/app/playground/components/button";
import { ArrowLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

type AuthFormVariant = "login" | "register";
type AuthFormStrategy = "commercial" | "non-commercial";

interface AuthFormProps {
  variant: AuthFormVariant;
  strategy: AuthFormStrategy;
}

const buttonText = {
  login: "Sign in",
  register: "Register",
} as const;

const getPasswordAutoCompleteType = (variant: AuthFormVariant): HTMLInputAutoCompleteAttribute => {
  switch (variant) {
      case "login": {
        return "current-password"
      }
      case "register": {
        return "password"
      }
  }
}

const AuthBackButton = () => {
  const isLoading = useIsLoading();

  return (
    <AnimatePresence>
      {!isLoading && (
        <motion.div
          transition={{ duration: 0.12, width: { delay: 0.06 } }}
          initial={false}
          animate={{ width: "auto", opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
        >
          <div className="size-fit mr-2">
            <IconButton size="large" icon={ArrowLeft} variant="outline" href="/playground" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const handleGoogleSignIn = () => {
  // TODO: Google OAuth
};

const AuthFormInternal: FC<AuthFormProps> = ({ variant, strategy }) => {
  const store = useStore();
  const router = useRouter();
  const setShowPasswordField = useSetShowPasswordField();
  const setIsLoading = useSetIsLoading();
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (strategy === "non-commercial") {
      const showPasswordField = store.get(showPasswordFieldAtom);
      if (!showPasswordField) {
        setShowPasswordField(true);
        return;
      }

      setIsLoading(true);
      const formData = new FormData(event.currentTarget);
      const _username = formData.get("username");
      const _password = formData.get("password");
      // TODO: non-commercial auth logic
    } else {
      setIsLoading(true);
      const formData = new FormData(event.currentTarget);
      const _email = formData.get("email");
      setTimeout(() => router.push("/playground/dashboard"), 1000);
    }
  };

  useEffect(() => {
    formRef.current?.reset();
    setShowPasswordField(false);
    setIsLoading(false);
  }, [setShowPasswordField, setIsLoading]);

  if (strategy === "non-commercial") {
    return (
      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-2">
        <UsernameField />
        <PasswordField type="password" autoComplete={getPasswordAutoCompleteType(variant)} />
        <SubmitButton>{buttonText[variant]}</SubmitButton>
      </form>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-2">
      <OAuthButton
        onSignIn={handleGoogleSignIn}
        icon={<GoogleIcon className="size-4" />}
      >
        Continue with Google
      </OAuthButton>
      <FormDivider />
      <EmailField />
      <div className="flex items-center">
        <AuthBackButton />
        <SubmitButton>{buttonText[variant]}</SubmitButton>
      </div>
    </form>
  );
};

const AuthForm: FC<AuthFormProps> = ({ ...props }) => (
    <Provider>
      <AuthFormInternal {...props} />
    </Provider>
  )

export { AuthForm }
