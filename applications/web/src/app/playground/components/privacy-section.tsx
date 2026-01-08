import type { FC, PropsWithChildren } from "react";

const PrivacySection: FC<PropsWithChildren> = ({ children }) => (
  <section className="flex flex-col gap-4">{children}</section>
);

export { PrivacySection };
