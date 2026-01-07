import type { ComponentProps, FC, PropsWithChildren } from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { Spinner } from "@/components/spinner";

type ButtonProps = ComponentProps<typeof BaseButton> & {
  isLoading?: boolean;
};

export const Button: FC<PropsWithChildren<ButtonProps>> = ({
  isLoading,
  children,
  disabled,
  className,
  ...props
}) => {
  const renderContent = (): React.ReactNode => {
    if (isLoading) {
      return (
        <span className="relative inline-flex items-center justify-center">
          <span className="invisible">{children}</span>
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </span>
        </span>
      );
    }
    return children;
  };

  return (
    <BaseButton disabled={isLoading || disabled} className={className} {...props}>
      {renderContent()}
    </BaseButton>
  );
};
