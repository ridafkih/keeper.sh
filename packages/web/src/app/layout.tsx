import "./globals.css";

import type { Metadata } from "next";
import { Onest } from "next/font/google";
import clsx from "clsx";
import { AuthProvider } from "@/components/auth-provider";

const font = Onest({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Keeper",
  description: "Calendar management and synchronization",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={clsx(font.className, "bg-background antialiased")}>
        <AuthProvider>
          <div className="isolate min-h-dvh flex flex-col">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
