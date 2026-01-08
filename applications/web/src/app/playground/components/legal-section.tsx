import type { FC, PropsWithChildren } from "react";

const LegalSection: FC<PropsWithChildren> = ({ children }) => (
  <section className="flex flex-col gap-4">{children}</section>
);

export { LegalSection };
