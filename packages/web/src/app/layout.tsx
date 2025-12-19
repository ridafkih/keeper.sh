import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
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
      <body className={outfit.className}>
        <AuthProvider>
          <div className="isolate min-h-dvh flex flex-col">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
