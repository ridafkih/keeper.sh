import type { ReactNode } from "react";
import { Header } from "@/components/header";

export default function AuthLayout({ children }: { children: React.ReactNode }): ReactNode {
  return (
    <div className="flex flex-col flex-1">
      <Header />
      {children}
    </div>
  );
}
