"use client";

import { useEffect, useRef } from "react";
import { Button, ButtonText } from "../../components/button";
import { FormField } from "../../components/form-field";
import { FormDivider } from "../../components/form-divider";
import { SocialButton } from "../../components/social-button";
import { GoogleIcon } from "@/components/icons/google";

export const LoginForm = () => {
  const formRef = useRef<HTMLFormElement>(null);

  const handleGoogleSignIn = () => {
    // TODO: Google OAuth
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = formData.get("email");
    // TODO: magic link auth
  };

  useEffect(() => {
    () => {
      formRef.current?.reset();
    }
  }, []);

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-2">
      <SocialButton
        onClick={handleGoogleSignIn}
        icon={<GoogleIcon className="size-4" />}
      >
        Continue with Google
      </SocialButton>
      <FormDivider />
      <FormField
        name="email"
        type="email"
        placeholder="Email"
        required
        autoComplete="email"
      />
      <Button size="large" type="submit" className="w-full text-center">
        <ButtonText className="w-full text-center">Sign in</ButtonText>
      </Button>
    </form>
  );
};
