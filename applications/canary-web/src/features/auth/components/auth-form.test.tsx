import { beforeAll, describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthCapabilities } from "../../../lib/auth-capabilities";
import type { AuthScreenCopy } from "./auth-form";

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
      passkey: mock(() => Promise.resolve({ error: null })),
    },
  },
}));

mock.module("../../../components/ui/primitives/button", () => ({
  Button: ({ children, ...props }: React.ComponentPropsWithoutRef<"button">) => <button {...props}>{children}</button>,
  LinkButton: ({ children, ...props }: React.ComponentPropsWithoutRef<"a">) => <a {...props}>{children}</a>,
  ButtonText: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  ButtonIcon: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

mock.module("../../../components/ui/primitives/divider", () => ({
  Divider: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

mock.module("../../../components/ui/primitives/text-link", () => ({
  TextLink: ({ children, ...props }: React.ComponentPropsWithoutRef<"a">) => <a {...props}>{children}</a>,
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
  it("uses username autofill semantics for passkey sign-in", () => {
    const markup = renderToStaticMarkup(<AuthForm capabilities={capabilities} copy={copy} />);

    expect(markup).toContain('autoComplete="username webauthn"');
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
});
