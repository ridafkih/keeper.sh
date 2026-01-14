import type { FC, ReactNode } from "react";
import { tv } from "tailwind-variants";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import { Button, ButtonText } from "./button";

type NoticeVariant = "warning" | "error" | "info";

const noticeVariants = tv({
  slots: {
    wrapper: "flex flex-col gap-2",
    container: "flex items-start gap-3 p-4 rounded-xl border",
    iconWrapper: "shrink-0 mt-0.5",
    content: "flex-1 min-w-0",
    title: "text-xs font-medium",
    description: "text-xs mt-0.5",
  },
  variants: {
    variant: {
      warning: {
        container: "bg-amber-100/25 border-amber-400/50",
        iconWrapper: "text-amber-400",
        title: "text-amber-950",
        description: "text-amber-950",
      },
      error: {
        container: "bg-red-100/25 border-red-400/50",
        iconWrapper: "text-red-400",
        title: "text-red-950",
        description: "text-red-950",
      },
      info: {
        container: "bg-neutral-100/25 border-neutral-400/50",
        iconWrapper: "text-neutral-400",
        title: "text-neutral-950",
        description: "text-neutral-950",
      },
    },
  },
  defaultVariants: {
    variant: "info",
  },
});

const noticeIcons: Record<NoticeVariant, FC<{ className?: string }>> = {
  warning: ({ className }) => <AlertTriangle size={16} className={className} />,
  error: ({ className }) => <AlertCircle size={16} className={className} />,
  info: ({ className }) => <Info size={16} className={className} />,
};

interface NoticeActionProps {
  label: string;
  onAction: () => void;
}

interface NoticeProps {
  variant?: NoticeVariant;
  title: string;
  description?: string;
  action?: NoticeActionProps;
  icon?: ReactNode;
}

const Notice: FC<NoticeProps> = ({
  variant = "info",
  title,
  description,
  action,
  icon,
}) => {
  const styles = noticeVariants({ variant });
  const DefaultIcon = noticeIcons[variant];

  const handleActionClick = () => {
    action?.onAction();
  };

  return (
    <div className={styles.wrapper()}>
      <div className={styles.container()}>
        <div className={styles.iconWrapper()}>
          {icon ?? <DefaultIcon />}
        </div>
        <div className={styles.content()}>
          <p className={styles.title()}>{title}</p>
          {description && (
            <p className={styles.description()}>{description}</p>
          )}
        </div>
      </div>
      {action && (
        <Button variant="primary" size="small" className="w-full" onClick={handleActionClick}>
          <ButtonText>{action.label}</ButtonText>
        </Button>
      )}
    </div>
  );
};

export { Notice };
export type { NoticeVariant, NoticeProps };
