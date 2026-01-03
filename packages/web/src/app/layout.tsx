import "./globals.css";

import { Analytics } from "@vercel/analytics/next";

import type { Metadata } from "next";
import { Onest } from "next/font/google";
import clsx from "clsx";
import { AuthProvider } from "@/components/auth-provider";
import Script from "next/script";

const font = Onest({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Keeper",
  description: "Calendar management and synchronization",
};

const { NEXT_PUBLIC_VISITORS_NOW_TOKEN } = process.env;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {NEXT_PUBLIC_VISITORS_NOW_TOKEN && (
          <Script
            src="https://cdn.visitors.now/v.js"
            data-token={NEXT_PUBLIC_VISITORS_NOW_TOKEN}
          />
        )}
      </head>
      <body className={clsx(font.className, "bg-background antialiased")}>
        <AuthProvider>
          <div className="isolate min-h-dvh flex flex-col">{children}</div>
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  );
}
