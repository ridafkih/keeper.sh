import type { ComponentProps, FC, PropsWithChildren } from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { tv, type VariantProps } from "tailwind-variants";
import { Spinner } from "@/components/spinner";

const buttonVariants = tv({
  base: "",
  variants: {
    size: {
      default: "",
      small: "text-sm py-1 px-2",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

const getClassNameAsString = (candidateClassName: unknown): string | null => {
  if (typeof candidateClassName !== 'string') {
    return null;
  }

  return candidateClassName;
}

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

type ButtonProps = ComponentProps<typeof BaseButton> &
  ButtonVariantProps & {
    isLoading?: boolean;
  };

const Button: FC<PropsWithChildren<ButtonProps>> = ({
  isLoading,
  children,
  disabled,
  size,
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

  const className = getClassNameAsString(props.className);

  return (
    <BaseButton
      disabled={isLoading || disabled}
      className={buttonVariants({ size, className })}
      {...props}
    >
      {renderContent()}
    </BaseButton>
  );
};

export { Button }
