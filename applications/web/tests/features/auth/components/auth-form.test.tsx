import { beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import type { AuthCapabilities } from "@/lib/auth-capabilities";
import type { AuthScreenCopy } from "../../../../src/features/auth/components/auth-form";

const { passkeySignInMock, omitMotionProps } = vi.hoisted(() => {
  const passkeySignInMock = vi.fn(() => Promise.resolve({ error: null }));

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

  return { passkeySignInMock, omitMotionProps };
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

describe("AuthForm", () => {
  it("uses username webauthn autocomplete for passkey sign-in", () => {
    const markup = renderToStaticMarkup(<AuthForm capabilities={capabilities} copy={copy} />);

    expect(markup).toContain('autoComplete="username webauthn"');
    expect(markup).not.toContain("Use passkey");
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

    const { document, window } = parseHTML("<html><body><div id='app'></div></body></html>");
    const previousGlobals = {
      Event: globalThis.Event,
      FocusEvent: globalThis.FocusEvent,
      HTMLElement: globalThis.HTMLElement,
      Node: globalThis.Node,
      PublicKeyCredential: globalThis.PublicKeyCredential,
      document: globalThis.document,
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

    const container = document.getElementById("app");
    if (!container) throw new Error("Expected app container");

    if (!(container instanceof HTMLElement)) {
      throw Error("container must be Element")
    }

    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<AuthForm capabilities={capabilities} copy={copy} />);
      });

      expect(passkeySignInMock).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        root.unmount();
      });
      Object.defineProperty(globalThis, "navigator", { value: previousGlobals.navigator, configurable: true, writable: true });
      Object.assign(globalThis, previousGlobals);
    }
  });
});
