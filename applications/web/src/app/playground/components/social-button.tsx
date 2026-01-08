import type { FC, PropsWithChildren, ReactNode } from "react";
import { Button, ButtonText } from "./button";

interface SocialButtonProps {
  onClick: () => void;
  icon: ReactNode;
  disabled?: boolean;
}

const SocialButton: FC<PropsWithChildren<SocialButtonProps>> = ({
  onClick,
  icon,
  disabled,
  children,
}) => (
  <Button
    type="button"
    variant="outline"
    size="large"
    onClick={onClick}
    disabled={disabled}
    className="w-full justify-center"
  >
    <div className="flex items-center gap-2">
      {icon}
      <ButtonText>{children}</ButtonText>
    </div>
  </Button>
);

export { SocialButton };
