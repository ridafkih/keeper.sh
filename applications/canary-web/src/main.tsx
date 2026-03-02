import { StrictMode } from "react";
import "./index.css";
import { scan } from "react-scan";

if (import.meta.env.DEV) {
  scan({ enabled: true });
}
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";

import { routeTree } from "./generated/tanstack/route-tree.generated"

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById("root");

if (rootElement && !rootElement.innerHTML) {
  const root = createRoot(rootElement);

  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  )
}
