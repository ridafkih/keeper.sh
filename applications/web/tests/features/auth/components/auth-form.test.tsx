import { beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import type { AuthCapabilities } from "@/lib/auth-capabilities";
import type { AuthScreenCopy } from "../../../../src/features/auth/components/auth-form";

const { passkeySignInMock, oauth2SignInMock, omitMotionProps } = vi.hoisted(() => {
  const passkeySignInMock = vi.fn(() => Promise.resolve({ error: null }));
  const oauth2SignInMock = vi.fn<(options: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>>(
    () => Promise.resolve({ error: null }),
  );

  const omitMotionProps = <T extends Record<string, unknown>>(props: T) => {
    const domProps = { ...props };
    delete domProps.animate;
    delete domProps.exit;
    delete domProps.initial;
    delete domProps.layout;
    delete domProps.transition;
    delete domProps.variants;
    return domProps;
  };

  return { passkeySignInMock, oauth2SignInMock, omitMotionProps };
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.ComponentPropsWithoutRef<"a">) => <a {...props}>{children}</a>,
  useNavigate: () => () => undefined,
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  LazyMotion: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock("motion/react-m", () => ({
  div: ({ children, ...props }: React.ComponentPropsWithoutRef<"div">) => (
    <div {...omitMotionProps(props)}>{children}</div>
  ),
  span: ({ children, ...props }: React.ComponentPropsWithoutRef<"span">) => (
    <span {...omitMotionProps(props)}>{children}</span>
  ),
}));

vi.mock("../../../../src/lib/motion-features", () => ({
  loadMotionFeatures: async () => ({}),
}));

vi.mock("../../../../src/lib/auth-client", () => ({
  authClient: {
    signIn: {
      oauth2: oauth2SignInMock,
      passkey: passkeySignInMock,
    },
  },
}));

vi.mock("../../../../src/components/ui/primitives/button", () => ({
  Button: ({ children, ...props }: React.ComponentPropsWithoutRef<"button">) => <button {...props}>{children}</button>,
  LinkButton: ({ children, ...props }: React.ComponentPropsWithoutRef<"a">) => <a {...props}>{children}</a>,
  ExternalLinkButton: ({ children, ...props }: React.ComponentPropsWithoutRef<"a">) => <a {...props}>{children}</a>,
  ButtonText: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  ButtonIcon: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock("../../../../src/components/ui/primitives/divider", () => ({
  Divider: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock("../../../../src/components/ui/primitives/text-link", () => ({
  TextLink: ({ children, ...props }: React.ComponentPropsWithoutRef<"a">) => <a {...props}>{children}</a>,
  ExternalTextLink: ({ children, ...props }: React.ComponentPropsWithoutRef<"a">) => <a {...props}>{children}</a>,
}));

vi.mock("../../../../src/components/ui/primitives/heading", () => ({
  Heading2: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
}));

vi.mock("../../../../src/components/ui/primitives/input", () => ({
  Input: (props: React.ComponentPropsWithoutRef<"input">) => <input {...props} />,
}));

vi.mock("../../../../src/components/ui/primitives/text", () => ({
  Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));

vi.mock("../../../../src/features/auth/components/auth-switch-prompt", () => ({
  AuthSwitchPrompt: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock("lucide-react/dist/esm/icons/arrow-left", () => ({
  default: (props: React.ComponentPropsWithoutRef<"svg">) => <svg {...props} />,
}));

vi.mock("lucide-react/dist/esm/icons/loader-circle", () => ({
  default: (props: React.ComponentPropsWithoutRef<"svg">) => <svg {...props} />,
}));

let AuthForm: typeof import("../../../../src/features/auth/components/auth-form").AuthForm;

beforeAll(async () => {
  ({ AuthForm } = await import("../../../../src/features/auth/components/auth-form"));
});

const capabilities: AuthCapabilities = {
  commercialMode: true,
  credentialMode: "email",
  requiresEmailVerification: true,
  socialProviders: {
    google: false,
    microsoft: false,
  },
  supportsChangePassword: true,
  supportsPasskeys: true,
  supportsPasswordReset: true,
};

const copy: AuthScreenCopy = {
  heading: "Welcome back",
  subtitle: "Sign in to your Keeper.sh account",
  oauthActionLabel: "Sign in",
  submitLabel: "Sign in",
  switchPrompt: "Don't have an account yet?",
  switchCta: "Register",
  switchTo: "/register",
  action: "signIn",
};

const renderInDom = async (
  element: React.ReactElement,
  run: (container: HTMLElement) => Promise<void>,
) => {
  const { document, window } = parseHTML("<html><body><div id='app'></div></body></html>");
  const previousGlobals = {
    Event: globalThis.Event,
    FocusEvent: globalThis.FocusEvent,
    HTMLElement: globalThis.HTMLElement,
    Node: globalThis.Node,
    PublicKeyCredential: globalThis.PublicKeyCredential,
    document: globalThis.document,
    location: globalThis.location,
    navigator: globalThis.navigator,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    window: globalThis.window,
  };

  class FakePublicKeyCredential {}
  Object.assign(FakePublicKeyCredential, {
    isConditionalMediationAvailable: vi.fn(() => Promise.resolve(true)),
  });

  Object.assign(globalThis, {
    Event: window.Event,
    FocusEvent: window.FocusEvent ?? window.Event,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    Node: window.Node,
    PublicKeyCredential: FakePublicKeyCredential,
    document,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    window,
  });
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true, writable: true });
  Object.defineProperty(globalThis, "location", {
    value: { assign: vi.fn(), origin: "http://localhost:3000" },
    configurable: true,
    writable: true,
  });

  const container = document.getElementById("app");
  if (!container) throw new Error("Expected app container");

  if (!(container instanceof HTMLElement)) {
    throw Error("container must be Element")
  }

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(element);
    });

    await run(container);
  } finally {
    await act(async () => {
      root.unmount();
    });
    Object.defineProperty(globalThis, "navigator", { value: previousGlobals.navigator, configurable: true, writable: true });
    Object.defineProperty(globalThis, "location", { value: previousGlobals.location, configurable: true, writable: true });
    Object.assign(globalThis, previousGlobals);
  }
};

const clickButtonWithText = async (container: HTMLElement, text: string) => {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text));
  if (!button) throw new Error(`Expected a button containing "${text}"`);

  await act(async () => {
    button.dispatchEvent(new globalThis.window.Event("click", { bubbles: true }));
  });
};

describe("AuthForm", () => {
  it("uses username webauthn autocomplete for passkey sign-in", () => {
    const markup = renderToStaticMarkup(<AuthForm capabilities={capabilities} copy={copy} />);

    expect(markup).toContain('autoComplete="username webauthn"');
    expect(markup).not.toContain("Use passkey");
  });

  it("renders the OIDC button when the oidc provider is enabled", () => {
    const markup = renderToStaticMarkup(
      <AuthForm
        capabilities={{
          ...capabilities,
          socialProviders: { google: false, microsoft: false, oidc: true },
          oidcProviderName: "Pocket ID",
        }}
        copy={copy}
      />,
    );

    expect(markup).toContain('<button type="button"');
    expect(markup).toContain("Sign in with Pocket ID");
    expect(markup).not.toContain("/auth/oidc");
  });

  it("hides the credential form when local auth is disabled", () => {
    const markup = renderToStaticMarkup(
      <AuthForm
        capabilities={{
          ...capabilities,
          disableLocalAuth: true,
          socialProviders: { google: false, microsoft: false, oidc: true },
        }}
        copy={copy}
      />,
    );

    expect(markup).not.toContain('name="email"');
    expect(markup).not.toContain("<div>or</div>");
    expect(markup).toContain("Sign in with SSO");
    expect(markup).not.toContain("Register");
  });

  it("keeps email autofill semantics for registration", () => {
    const markup = renderToStaticMarkup(
      <AuthForm
        capabilities={capabilities}
        copy={{ ...copy, action: "signUp", switchCta: "Login", switchPrompt: "Have an account?", switchTo: "/login" }}
      />,
    );

    expect(markup).toContain('autoComplete="email"');
  });

  it("keeps the password field mounted for sign-in autofill heuristics", () => {
    const markup = renderToStaticMarkup(<AuthForm capabilities={capabilities} copy={copy} />);

    expect(markup).toContain('name="password"');
    expect(markup).toContain('autoComplete="current-password"');
  });

  it("uses conventional field ids, names, and labels for sign-in heuristics", () => {
    const markup = renderToStaticMarkup(<AuthForm capabilities={capabilities} copy={copy} />);

    expect(markup).toContain('id="email"');
    expect(markup).toContain('name="email"');
    expect(markup).toContain('for="email"');
    expect(markup).toContain('id="current-password"');
    expect(markup).toContain('for="current-password"');
  });
  it("starts passive passkey sign-in on render when conditional mediation is available", async () => {
    passkeySignInMock.mockClear();

    await renderInDom(<AuthForm capabilities={capabilities} copy={copy} />, async () => {
      expect(passkeySignInMock).toHaveBeenCalledTimes(1);
    });
  });

  it("starts the OIDC redirect straight from the sign-in button", async () => {
    oauth2SignInMock.mockClear();

    await renderInDom(
      <AuthForm
        capabilities={{ ...capabilities, socialProviders: { google: false, microsoft: false, oidc: true } }}
        copy={copy}
      />,
      async (container) => {
        await clickButtonWithText(container, "Sign in with SSO");

        expect(oauth2SignInMock).toHaveBeenCalledWith({
          callbackURL: "/dashboard",
          newUserCallbackURL: "/dashboard?keeper_signup=1",
          providerId: "oidc",
        });
      },
    );
  });

  it("recovers the form when the OIDC redirect request throws", async () => {
    oauth2SignInMock.mockClear();
    oauth2SignInMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await renderInDom(
      <AuthForm
        capabilities={{ ...capabilities, socialProviders: { google: false, microsoft: false, oidc: true } }}
        copy={copy}
      />,
      async (container) => {
        await clickButtonWithText(container, "Sign in with SSO");

        const button = [...container.querySelectorAll("button")].find((candidate) =>
          candidate.textContent?.includes("Sign in with SSO"));
        expect(button?.hasAttribute("disabled")).toBe(false);
        expect(container.textContent).toContain("Failed to fetch");
      },
    );
  });

  it("shows a failed OIDC redirect on the form when local auth is disabled", async () => {
    oauth2SignInMock.mockClear();
    oauth2SignInMock.mockResolvedValueOnce({ error: { message: "Discovery failed" } });

    await renderInDom(
      <AuthForm
        capabilities={{
          ...capabilities,
          disableLocalAuth: true,
          socialProviders: { google: false, microsoft: false, oidc: true },
        }}
        copy={copy}
      />,
      async (container) => {
        await clickButtonWithText(container, "Sign in with SSO");

        expect(container.textContent).toContain("Discovery failed");
      },
    );
  });
});
