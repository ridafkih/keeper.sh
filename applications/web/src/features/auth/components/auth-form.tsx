import { useEffect, useRef, type Ref, type SubmitEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { AnimatePresence, LazyMotion, type TargetAndTransition, type Variants } from "motion/react";
import { loadMotionFeatures } from "@/lib/motion-features";
import * as m from "motion/react-m";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import {
  authFormStatusAtom,
  authFormErrorAtom,
  authFormStepAtom,
  type AuthFormStatus,
} from "@/state/auth-form";
import { authClient } from "@/lib/auth-client";
import {
  getEnabledSocialProviders,
  resolveCredentialField,
  type AuthCapabilities,
} from "@/lib/auth-capabilities";
import { signInWithCredential, signUpWithCredential } from "@/lib/auth";
import {
  Button,
  LinkButton,
  ExternalLinkButton,
  ButtonText,
  ButtonIcon,
} from "@/components/ui/primitives/button";
import { Divider } from "@/components/ui/primitives/divider";
import { ExternalTextLink, TextLink } from "@/components/ui/primitives/text-link";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Input } from "@/components/ui/primitives/input";
import { Text } from "@/components/ui/primitives/text";
import { resolveErrorMessage } from "@/utils/errors";
import {
  getMcpAuthorizationSearch,
  resolvePathWithSearch,
  resolveClientPostAuthRedirect,
  type StringSearchParams,
} from "@/lib/mcp-auth-flow";
import { AuthSwitchPrompt } from "./auth-switch-prompt";

function resolveInputTone(active: boolean | undefined): "error" | "neutral" {
  if (active) return "error";
  return "neutral";
}

function resolveSwitchSearch(search?: StringSearchParams): StringSearchParams | undefined {
  if (!search) return undefined;
  const result = getMcpAuthorizationSearch(search);
  if (!result) return undefined;
  return result;
}

export type AuthScreenCopy = {
  heading: string;
  subtitle: string;
  oauthActionLabel: string;
  submitLabel: string;
  switchPrompt: string;
  switchCta: string;
  switchTo: "/login" | "/register";
  action: "signIn" | "signUp";
};

type SocialAuthProvider = {
  id: "google" | "microsoft";
  label: string;
  to: "/auth/google" | "/auth/outlook";
  iconSrc: string;
};

const SOCIAL_AUTH_PROVIDERS: readonly SocialAuthProvider[] = [
  { id: "google", label: "Google", to: "/auth/google", iconSrc: "/integrations/icon-google.svg" },
  { id: "microsoft", label: "Outlook", to: "/auth/outlook", iconSrc: "/integrations/icon-outlook.svg" },
];

const submitTextVariants: Record<AuthFormStatus, Variants[string]> = {
  idle: { opacity: 1, filter: "none", y: 0, scale: 1 },
  loading: { opacity: 0, filter: "blur(2px)", y: -2, scale: 0.75 },
};

const backButtonVariants: Variants = {
  hidden: { width: 0, opacity: 0, filter: "blur(2px)" },
  visible: { width: "auto", opacity: 1, filter: "blur(0px)" },
};

function resolvePasswordFieldAnimation(step: "email" | "password"): TargetAndTransition {
  if (step === "password") {
    return { height: "auto", opacity: 1, overflow: "visible" };
  }

  return { height: 0, opacity: 0, overflow: "hidden" };
}

export function AuthForm({
  capabilities,
  copy,
  authorizationSearch,
}: {
  capabilities: AuthCapabilities;
  copy: AuthScreenCopy;
  authorizationSearch?: StringSearchParams;
}) {
  const hasSocialProviders = getEnabledSocialProviders(capabilities).length > 0;
  const switchSearch = resolveSwitchSearch(authorizationSearch);
  const switchHref = resolvePathWithSearch(copy.switchTo, switchSearch);

  return (
    <>
      {copy.action === "signIn" && capabilities.supportsPasskeys && (
        <PasskeyAutoFill authorizationSearch={authorizationSearch} />
      )}
      <div className="flex flex-col py-2">
        <Heading2 as="span" className="text-center">{copy.heading}</Heading2>
        <Text size="sm" tone="muted" align="center">{copy.subtitle}</Text>
      </div>
      {hasSocialProviders && (
        <>
          <SocialAuthButtons
            capabilities={capabilities}
            oauthActionLabel={copy.oauthActionLabel}
            authorizationSearch={authorizationSearch}
          />
          <Divider>or</Divider>
        </>
      )}
      <CredentialForm
        capabilities={capabilities}
        submitLabel={copy.submitLabel}
        action={copy.action}
        authorizationSearch={authorizationSearch}
      />
      <div className="flex flex-col gap-1.5">
        <AuthError />
        <AuthSwitchPrompt>
          {copy.switchPrompt}{" "}
          <ExternalTextLink href={switchHref}>
            {copy.switchCta}
          </ExternalTextLink>
        </AuthSwitchPrompt>
      </div>
    </>
  );
}

function redirectAfterAuth(authorizationSearch?: StringSearchParams) {
  if (typeof window === "undefined" || !window.location) {
    return;
  }

  const redirectTarget = resolveClientPostAuthRedirect(authorizationSearch);
  const nextUrl = new URL(redirectTarget, window.location.origin).toString();
  window.location.assign(nextUrl);
}

function usePasskeyAutoFill(authorizationSearch?: StringSearchParams) {
  const setError = useSetAtom(authFormErrorAtom);

  useEffect(() => {
    if (typeof PublicKeyCredential === "undefined") {
      return;
    }

    const controller = new AbortController();

    const attemptAutoFill = async () => {
      const available = await PublicKeyCredential.isConditionalMediationAvailable?.();
      if (!available) return;

      const { error } = await authClient.signIn.passkey({
        autoFill: true,
        fetchOptions: { signal: controller.signal },
      });

      if (error) {
        if ("code" in error && error.code === "AUTH_CANCELLED") {
          return;
        }
        setError({ message: error.message ?? "Passkey sign-in failed.", active: true });
        return;
      }

      redirectAfterAuth(authorizationSearch);
    };

    void attemptAutoFill();

    return () => controller.abort();
  }, [authorizationSearch, setError]);
}

interface PasskeyAutoFillProps {
  authorizationSearch?: StringSearchParams;
}

function PasskeyAutoFill({ authorizationSearch }: PasskeyAutoFillProps) {
  usePasskeyAutoFill(authorizationSearch);
  return null;
}

function SocialAuthButtons({
  capabilities,
  oauthActionLabel,
  authorizationSearch,
}: {
  capabilities: AuthCapabilities;
  oauthActionLabel: string;
  authorizationSearch?: StringSearchParams;
}) {
  const enabledSocialProviders = new Set(getEnabledSocialProviders(capabilities));
  const visibleProviders = SOCIAL_AUTH_PROVIDERS.filter((provider) =>
    enabledSocialProviders.has(provider.id));

  if (visibleProviders.length === 0) {
    return null;
  }

  return (
    <>
      {visibleProviders.map((provider) => (
        <ExternalLinkButton
          key={provider.id}
          href={resolvePathWithSearch(provider.to, authorizationSearch)}
          className="w-full justify-center"
          variant="border"
        >
          <ButtonIcon>
            <img src={provider.iconSrc} alt="" width={16} height={16} />
          </ButtonIcon>
          <ButtonText>{`${oauthActionLabel} with ${provider.label}`}</ButtonText>
        </ExternalLinkButton>
      ))}
    </>
  );
}

function FormBackButton({ step, onBack }: { step: "email" | "password"; onBack: () => void }) {
  if (step === "password") return <StepBackButton onBack={onBack} />;
  return <BackButton />;
}

function ForgotPasswordLink({
  action,
  capabilities,
}: {
  action: "signIn" | "signUp";
  capabilities: AuthCapabilities;
}) {
  if (action !== "signIn" || !capabilities.supportsPasswordReset) return null;
  return (
    <div className="flex justify-end">
      <TextLink to="/forgot-password" size="xs">Forgot password?</TextLink>
    </div>
  );
}

function resolveAutoComplete(
  action: "signIn" | "signUp",
  base: string,
  capabilities: AuthCapabilities,
): string {
  if (action === "signIn" && capabilities.supportsPasskeys) {
    if (base === "email" || base === "username") {
      return "username webauthn";
    }
  }
  return base;
}

function readFormFieldValue(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName);
  if (typeof value === "string") return value;
  return "";
}

function CredentialForm({
  capabilities,
  submitLabel,
  action,
  authorizationSearch,
}: {
  capabilities: AuthCapabilities;
  submitLabel: string;
  action: "signIn" | "signUp";
  authorizationSearch?: StringSearchParams;
}) {
  const navigate = useNavigate();
  const step = useAtomValue(authFormStepAtom);
  const setStep = useSetAtom(authFormStepAtom);
  const setStatus = useSetAtom(authFormStatusAtom);
  const setError = useSetAtom(authFormErrorAtom);
  const passwordRef = useRef<HTMLInputElement>(null);
  const credentialField = resolveCredentialField(capabilities);

  useEffect(() => {
    if (typeof sessionStorage === "undefined") {
      return;
    }
    sessionStorage.removeItem("pendingVerificationEmail");
    sessionStorage.removeItem("pendingVerificationCallbackUrl");
  }, []);

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const credential = readFormFieldValue(formData, credentialField.name);

    if (step === "email") {
      if (!credential) return;
      setStep("password");
      requestAnimationFrame(() => passwordRef.current?.focus());
      return;
    }

    const password = readFormFieldValue(formData, "password");
    if (!password) return;

    setStatus("loading");
    const redirectTarget = resolveClientPostAuthRedirect(authorizationSearch);

    const authActions: Record<string, () => Promise<void>> = {
      signIn: () => signInWithCredential(credential, password, capabilities),
      signUp: () => signUpWithCredential(credential, password, capabilities, redirectTarget),
    };

    try {
      await authActions[action]();
    } catch (error) {
      setStatus("idle");
      setError({
        message: resolveErrorMessage(error, "Something went wrong. Please try again."),
        active: true,
      });
      return;
    }

    if (action === "signUp" && capabilities.requiresEmailVerification) {
      sessionStorage.setItem("pendingVerificationEmail", credential);
      sessionStorage.setItem("pendingVerificationCallbackUrl", redirectTarget);
      navigate({ to: "/verify-email" });
      return;
    }

    redirectAfterAuth(authorizationSearch);
  };

  const handleBack = () => {
    setStep("email");
    setError(null);
  };

  return (
    <form onSubmit={handleSubmit} className="contents">
      <div className="flex flex-col gap-0">
        <CredentialInput
          id={credentialField.id}
          name={credentialField.name}
          readOnly={step === "password"}
          autoComplete={resolveAutoComplete(action, credentialField.autoComplete, capabilities)}
          label={credentialField.label}
          placeholder={credentialField.placeholder}
          type={credentialField.type}
        />
        <LazyMotion features={loadMotionFeatures}>
          <m.div
            className={step === "password" ? "" : "pointer-events-none"}
            initial={false}
            animate={resolvePasswordFieldAnimation(step)}
            transition={{ duration: 0.2 }}
          >
            <div className="pt-1.5">
              <PasswordInput
                ref={passwordRef}
                autoComplete={resolveAutoComplete(action, "current-password", capabilities)}
                tabIndex={step === "password" ? undefined : -1}
              />
            </div>
          </m.div>
        </LazyMotion>
      </div>
      <div className="flex items-stretch">
        <FormBackButton step={step} onBack={handleBack} />
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
      <ForgotPasswordLink action={action} capabilities={capabilities} />
    </form>
  );
}

function resolveAuthErrorAnimation(active: boolean | undefined): TargetAndTransition {
  if (active) return { height: "auto", opacity: 1, filter: "blur(0px)" };
  return { height: 0, opacity: 0, filter: "blur(4px)" };
}

function AuthError() {
  const error = useAtomValue(authFormErrorAtom);
  const active = error?.active;

  return (
    <LazyMotion features={loadMotionFeatures}>
      <m.div
        className="overflow-hidden"
        initial={false}
        animate={resolveAuthErrorAnimation(active)}
        transition={{ duration: 0.2 }}
      >
        <p className="text-sm tracking-tight text-destructive text-center">
          {error?.message}
        </p>
      </m.div>
    </LazyMotion>
  );
}

function CredentialInput({
  id,
  name,
  readOnly,
  autoComplete,
  label,
  onFocus,
  placeholder,
  type,
}: {
  id: string;
  name: string;
  readOnly?: boolean;
  autoComplete?: string;
  label: string;
  onFocus?: () => void;
  placeholder: string;
  type: "email" | "text";
}) {
  const status = useAtomValue(authFormStatusAtom);
  const error = useAtomValue(authFormErrorAtom);
  const setError = useSetAtom(authFormErrorAtom);

  const clearError = () => {
    if (error?.active) setError({ ...error, active: false });
  };

  return (
    <>
      <label htmlFor={id} className="sr-only">{label}</label>
      <Input
        aria-label={label}
        id={id}
        name={name}
        readOnly={readOnly}
        disabled={status === "loading"}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        tone={resolveInputTone(error?.active)}
        onChange={clearError}
        onFocus={onFocus}
      />
    </>
  );
}

function PasswordInput({
  ref,
  autoComplete,
  tabIndex,
}: {
  ref?: Ref<HTMLInputElement>;
  autoComplete?: string;
  tabIndex?: number;
}) {
  const status = useAtomValue(authFormStatusAtom);
  const error = useAtomValue(authFormErrorAtom);
  const setError = useSetAtom(authFormErrorAtom);

  const clearError = () => {
    if (error?.active) setError({ ...error, active: false });
  };

  return (
    <>
      <label htmlFor="current-password" className="sr-only">Password</label>
      <Input
        ref={ref}
        id="current-password"
        name="password"
        disabled={status === "loading"}
        type="password"
        placeholder="Password"
        autoComplete={autoComplete}
        tabIndex={tabIndex}
        tone={resolveInputTone(error?.active)}
        onChange={clearError}
      />
    </>
  );
}

function AnimatedBackWrapper({ children }: { children: React.ReactNode }) {
  const status = useAtomValue(authFormStatusAtom);

  return (
    <LazyMotion features={loadMotionFeatures}>
      <AnimatePresence initial={false}>
        {status !== "loading" && (
          <m.div
            className="flex items-stretch"
            variants={backButtonVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={{ width: { duration: 0.24 }, opacity: { duration: 0.12 } }}
          >
            {children}
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}

function BackButton() {
  return (
    <AnimatedBackWrapper>
      <LinkButton to="/" variant="border" className="self-stretch justify-center mr-2">
        <ButtonIcon>
          <ArrowLeft size={16} />
        </ButtonIcon>
      </LinkButton>
    </AnimatedBackWrapper>
  );
}

function StepBackButton({ onBack }: { onBack: () => void }) {
  return (
    <AnimatedBackWrapper>
      <Button type="button" variant="border" className="self-stretch justify-center mr-2" onClick={onBack}>
        <ButtonIcon>
          <ArrowLeft size={16} />
        </ButtonIcon>
      </Button>
    </AnimatedBackWrapper>
  );
}

function SubmitButton({ children }: { children: string }) {
  const status = useAtomValue(authFormStatusAtom);

  return (
    <LazyMotion features={loadMotionFeatures}>
      <m.div className="grow" layout>
        <Button disabled={status === "loading"} type="submit" className="relative w-full justify-center">
          <m.span
            className="origin-top font-medium"
            variants={submitTextVariants}
            animate={status}
            transition={{ duration: 0.16 }}
          >
            {children}
          </m.span>
          <AnimatePresence>
            {status === "loading" && (
              <m.span
                className="absolute inset-0 m-auto size-fit origin-bottom"
                initial={{ opacity: 0, filter: "blur(2px)", y: 2, scale: 0.25 }}
                animate={{ opacity: 1, filter: "none", y: 0, scale: 1 }}
                exit={{ opacity: 0, filter: "blur(2px)", y: 2, scale: 0.25 }}
                transition={{ duration: 0.16 }}
              >
                <LoaderCircle className="animate-spin" size={16} />
              </m.span>
            )}
          </AnimatePresence>
        </Button>
      </m.div>
    </LazyMotion>
  );
}
