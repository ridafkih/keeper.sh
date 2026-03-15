import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { RouterClient } from "@tanstack/react-router/ssr/client";
import { createAppRouter } from "./router";

const rootElement = document.getElementById("root");
const router = createAppRouter();

if (rootElement && rootElement.innerHTML.length > 0) {
  hydrateRoot(
    document,
    <StrictMode>
      <RouterClient router={router} />
    </StrictMode>,
  );
} else if (rootElement) {
  const root = createRoot(rootElement);

  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
