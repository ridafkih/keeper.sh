import type { FC, PropsWithChildren } from "react";

const Layout: FC<PropsWithChildren> = ({ children }) => (
  <div className="bg-surface-subtle flex flex-col min-h-screen">{children}</div>
);

export default Layout;
