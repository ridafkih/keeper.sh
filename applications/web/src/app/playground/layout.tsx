import type { FC, PropsWithChildren } from "react";
import { Scaffold } from "./components/scaffold";

const Layout: FC<PropsWithChildren> = ({ children }) => (
  <Scaffold>{children}</Scaffold>
);

export default Layout;
