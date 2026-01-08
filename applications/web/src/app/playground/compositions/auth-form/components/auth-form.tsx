"use client";

import { FC, HTMLInputAutoCompleteAttribute, useEffect, useRef } from "react";
import { Provider, useStore } from "jotai";
import { Button, ButtonText } from "../../../components/button";
import { FormDivider } from "../../../components/form-divider";
import { SocialButton } from "../../../components/social-button";
import { GoogleIcon } from "@/components/icons/google";
import {
  showPasswordFieldAtom,
  useSetShowPasswordField,
} from "../contexts/auth-form-context";
import { EmailField } from "./email-field";
import { PasswordField } from "./password-field";

type AuthFormVariant = "login" | "register";

interface AuthFormProps {
  variant: AuthFormVariant;
}

const buttonText = {
  login: "Sign in",
  register: "Register",
} as const;

const getPasswordAutoCompleteType = (variant: AuthFormVariant): HTMLInputAutoCompleteAttribute => {
  switch (variant) {
      case "login":
        return "current-password"
      case "register":
        return "password"
  }
}

const AuthFormInternal: FC<AuthFormProps> = ({ variant }) => {
  const store = useStore();
  const setShowPasswordField = useSetShowPasswordField();
  const formRef = useRef<HTMLFormElement>(null);

  const handleGoogleSignIn = () => {
    // TODO: Google OAuth
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const showPasswordField = store.get(showPasswordFieldAtom);
    if (!showPasswordField) {
      setShowPasswordField(true);
      return;
    }

    const formData = new FormData(event.currentTarget);
    const email = formData.get("email");
    const password = formData.get("password");
    // TODO: auth logic based on variant
  };

  useEffect(() => {
    return () => {
      formRef.current?.reset();
      setShowPasswordField(false);
    };
  }, [setShowPasswordField]);

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-2">
      <SocialButton
        onClick={handleGoogleSignIn}
        icon={<GoogleIcon className="size-4" />}
      >
        Continue with Google
      </SocialButton>
      <FormDivider />
      <EmailField />
      <PasswordField type="password" autoComplete={getPasswordAutoCompleteType(variant)} />
      <Button size="large" type="submit" className="w-full text-center">
        <ButtonText className="w-full text-center">{buttonText[variant]}</ButtonText>
      </Button>
    </form>
  );
};

const AuthForm: FC<AuthFormProps> = ({ ...props }) => {
  return (
    <Provider>
      <AuthFormInternal {...props} />
    </Provider>
  )
}

export { AuthForm }
