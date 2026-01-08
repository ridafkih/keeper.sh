"use client";

import type { FC, ReactNode } from "react";
import { SocialButton } from "../../../components/social-button";
import { useIsLoading, useSetIsLoading } from "../contexts/auth-form-context";

interface OAuthButtonProps {
  icon: ReactNode;
  children: string;
  onSignIn: () => void;
  hideLoadingIndicator?: boolean;
}

export const OAuthButton: FC<OAuthButtonProps> = ({ icon, children, onSignIn, hideLoadingIndicator }) => {
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
      hideLoadingIndicator={hideLoadingIndicator}
    >
      {children}
    </SocialButton>
  );
};
