import { beforeAll, describe, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import type { AuthCapabilities } from "@/lib/auth-capabilities";
import type { AuthScreenCopy } from "./auth-form";

const passkeySignInMock = mock(() => Promise.resolve({ error: null }));

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

mock.module("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.ComponentPropsWithoutRef<"a">) => <a {...props}>{children}</a>,
  useNavigate: () => () => undefined,
}));

mock.module("motion/react", () => ({
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  LazyMotion: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

mock.module("motion/react-m", () => ({
  div: ({ children, ...props }: React.ComponentPropsWithoutRef<"div">) => (
    <div {...omitMotionProps(props)}>{children}</div>
  ),
  span: ({ children, ...props }: React.ComponentPropsWithoutRef<"span">) => (
    <span {...omitMotionProps(props)}>{children}</span>
  ),
}));

mock.module("../../../lib/motion-features", () => ({
  loadMotionFeatures: async () => ({}),
}));

mock.module("../../../lib/auth-client", () => ({
  authClient: {
    signIn: {
      passkey: passkeySignInMock,
    },
  },
}));

mock.module("../../../components/ui/primitives/button", () => ({
  Button: ({ children, ...props }: React.ComponentPropsWithoutRef<"button">) => <button {...props}>{children}</button>,
  LinkButton: ({ children, ...props }: React.ComponentPropsWithoutRef<"a">) => <a {...props}>{children}</a>,
  ExternalLinkButton: ({ children, ...props }: React.ComponentPropsWithoutRef<"a">) => <a {...props}>{children}</a>,
  ButtonText: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  ButtonIcon: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

mock.module("../../../components/ui/primitives/divider", () => ({
  Divider: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

mock.module("../../../components/ui/primitives/text-link", () => ({
  TextLink: ({ children, ...props }: React.ComponentPropsWithoutRef<"a">) => <a {...props}>{children}</a>,
  ExternalTextLink: ({ children, ...props }: React.ComponentPropsWithoutRef<"a">) => <a {...props}>{children}</a>,
}));

mock.module("../../../components/ui/primitives/heading", () => ({
  Heading2: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
}));

mock.module("../../../components/ui/primitives/input", () => ({
  Input: (props: React.ComponentPropsWithoutRef<"input">) => <input {...props} />,
}));

mock.module("../../../components/ui/primitives/text", () => ({
  Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));

mock.module("./auth-switch-prompt", () => ({
  AuthSwitchPrompt: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

mock.module("lucide-react/dist/esm/icons/arrow-left", () => ({
  default: (props: React.ComponentPropsWithoutRef<"svg">) => <svg {...props} />,
}));

mock.module("lucide-react/dist/esm/icons/loader-circle", () => ({
  default: (props: React.ComponentPropsWithoutRef<"svg">) => <svg {...props} />,
}));

let AuthForm: typeof import("./auth-form").AuthForm;

beforeAll(async () => {
  ({ AuthForm } = await import("./auth-form"));
});

const capabilities: AuthCapabilities = {
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
      isConditionalMediationAvailable: mock(() => Promise.resolve(true)),
    });

    Object.assign(globalThis, {
      Event: window.Event,
      FocusEvent: window.FocusEvent ?? window.Event,
      HTMLElement: window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
      Node: window.Node,
      PublicKeyCredential: FakePublicKeyCredential,
      document,
      navigator: window.navigator,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
      window,
    });

    window.event = undefined;
    window.HTMLElement.prototype.attachEvent = () => undefined;
    window.HTMLElement.prototype.detachEvent = () => undefined;

    const container = document.getElementById("app");
    if (!container) throw new Error("Expected app container");

    const root = createRoot(container as unknown as Element);

    try {
      await act(async () => {
        root.render(<AuthForm capabilities={capabilities} copy={copy} />);
      });

      expect(passkeySignInMock).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        root.unmount();
      });
      Object.assign(globalThis, previousGlobals);
    }
  });
});
