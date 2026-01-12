"use client";

import type { FC, ReactNode } from "react";
import { Button, ButtonText } from "../../../components/button";
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
    <Button
      type="button"
      variant="outline"
      size="large"
      onClick={handleClick}
      disabled={isLoading}
      className="w-full justify-center"
    >
      <div className="flex items-center gap-2">
        {icon}
        <ButtonText>{children}</ButtonText>
      </div>
    </Button>
  );
};
