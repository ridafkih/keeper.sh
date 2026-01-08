"use client";

import type { FC, ReactNode } from "react";
import { SocialButton } from "../../../components/social-button";
import { useIsLoading, useSetIsLoading } from "../contexts/auth-form-context";

interface OAuthButtonProps {
  icon: ReactNode;
  children: string;
  onSignIn: () => void;
}

export const OAuthButton: FC<OAuthButtonProps> = ({ icon, children, onSignIn }) => {
  const isLoading = useIsLoading();
  const setIsLoading = useSetIsLoading();

  const handleClick = () => {
    setIsLoading(true);
    onSignIn();
  };

  return (
    <SocialButton
      onClick={handleClick}
      icon={icon}
      disabled={isLoading}
    >
      {children}
    </SocialButton>
  );
};
