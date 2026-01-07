import type { FC, PropsWithChildren } from "react";

export const Section: FC<PropsWithChildren> = ({ children }) => (
  <section className="flex flex-col gap-3">{children}</section>
);
