"use client";

import type { FC } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { track } from "@/lib/analytics";

export const Footer: FC = () => (
  <footer className="flex flex-col gap-4 max-w-3xl mx-auto px-5 py-8 w-full">
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-foreground-muted">
      <div className="flex items-center gap-1">
        Made with <Heart className="size-3" /> by{" "}
        <a
          href="https://rida.dev/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground-secondary hover:text-foreground transition-colors"
        >
          Rida F'kih
        </a>
      </div>
      <nav className="flex gap-4">
        <Link
          href="/privacy"
          onClick={() => track("link_clicked", { target: "privacy" })}
          className="hover:text-foreground transition-colors"
        >
          Privacy Policy
        </Link>
        <Link
          href="/terms"
          onClick={() => track("link_clicked", { target: "terms" })}
          className="hover:text-foreground transition-colors"
        >
          Terms & Conditions
        </Link>
      </nav>
    </div>
  </footer>
);
