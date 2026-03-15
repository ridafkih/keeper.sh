import { useRouter, useCanGoBack, useNavigate } from "@tanstack/react-router";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import { Button, ButtonIcon, type ButtonProps } from "./button";

interface BackButtonProps {
  fallback?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

export function BackButton({
  fallback = "/dashboard",
  variant = "elevated",
  size = "compact",
  className = "aspect-square",
}: BackButtonProps) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();

  const handleBack = () => {
    if (canGoBack) return router.history.back();
    navigate({ to: fallback });
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={handleBack}
    >
      <ButtonIcon>
        <ArrowLeft size={16} />
      </ButtonIcon>
    </Button>
  );
}
