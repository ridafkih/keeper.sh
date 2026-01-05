import type { ReactNode } from "react";
import { Header } from "@/components/header";

const AuthLayout = ({ children }: { children: React.ReactNode }): ReactNode => (
  <div className="flex flex-col flex-1">
    <Header />
    {children}
  </div>
);

export default AuthLayout;
