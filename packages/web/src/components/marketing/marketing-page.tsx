import type { FC, PropsWithChildren } from "react";

interface MarketingPageProps {
  title?: string;
  description?: string;
}

export const MarketingPage: FC<PropsWithChildren<MarketingPageProps>> = ({
  title,
  description,
  children,
}) => (
  <>
    {title && (
      <div>
        <h1 className="text-3xl font-medium tracking-tight text-foreground mb-2">
          {title}
        </h1>
        {description && (
          <p className="text-foreground-secondary">{description}</p>
        )}
      </div>
    )}
    {children}
  </>
);
