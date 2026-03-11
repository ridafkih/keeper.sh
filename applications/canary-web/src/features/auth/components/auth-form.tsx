import { useEffect, useRef, type Ref, type SubmitEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { AnimatePresence, LazyMotion, type TargetAndTransition, type Variants } from "motion/react";
import { loadMotionFeatures } from "../../../lib/motion-features";
import * as m from "motion/react-m";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import {
  authFormStatusAtom,
  authFormErrorAtom,
  authFormStepAtom,
  type AuthFormStatus,
} from "../../../state/auth-form";
import { authClient } from "../../../lib/auth-client";
import {
  getEnabledSocialProviders,
  resolveCredentialField,
  type AuthCapabilities,
} from "../../../lib/auth-capabilities";
import { signInWithCredential, signUpWithCredential } from "../../../lib/auth";
import { Button, LinkButton, ButtonText, ButtonIcon } from "../../../components/ui/primitives/button";
import { Divider } from "../../../components/ui/primitives/divider";
import { TextLink } from "../../../components/ui/primitives/text-link";
import { Heading2 } from "../../../components/ui/primitives/heading";
import { Input } from "../../../components/ui/primitives/input";
import { Text } from "../../../components/ui/primitives/text";
import { resolveErrorMessage } from "../../../utils/errors";
import { AuthSwitchPrompt } from "./auth-switch-prompt";

function resolveAuthenticator(action: "signIn" | "signUp") {
  if (action === "signIn") return signInWithCredential;
  return signUpWithCredential;
}

function resolveInputTone(active: boolean | undefined): "error" | "neutral" {
  if (active) return "error";
  return "neutral";
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

export function AuthForm({
  capabilities,
  copy,
}: {
  capabilities: AuthCapabilities;
  copy: AuthScreenCopy;
}) {
  const hasSocialProviders = getEnabledSocialProviders(capabilities).length > 0;

  return (
    <>
      {copy.action === "signIn" && capabilities.supportsPasskeys && <PasskeyAutoFill />}
      <div className="flex flex-col py-2">
        <Heading2 as="span" className="text-center">{copy.heading}</Heading2>
        <Text size="sm" tone="muted" align="center">{copy.subtitle}</Text>
      </div>
      {hasSocialProviders && (
        <>
          <SocialAuthButtons capabilities={capabilities} oauthActionLabel={copy.oauthActionLabel} />
          <Divider>or</Divider>
        </>
      )}
      <CredentialForm
        capabilities={capabilities}
        submitLabel={copy.submitLabel}
        action={copy.action}
      />
      <div className="flex flex-col gap-1.5">
        <AuthError />
        <AuthSwitchPrompt>
          {copy.switchPrompt} <TextLink to={copy.switchTo}>{copy.switchCta}</TextLink>
        </AuthSwitchPrompt>
      </div>
    </>
  );
}

function usePasskeyAutoFill() {
  const navigate = useNavigate();
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

      navigate({ to: "/dashboard" });
    };

    void attemptAutoFill();

    return () => controller.abort();
  }, [navigate, setError]);
}

function PasskeyAutoFill() {
  usePasskeyAutoFill();
  return null;
}

function SocialAuthButtons({
  capabilities,
  oauthActionLabel,
}: {
  capabilities: AuthCapabilities;
  oauthActionLabel: string;
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
        <LinkButton key={provider.id} to={provider.to} className="w-full justify-center" variant="border">
          <ButtonIcon>
            <img src={provider.iconSrc} alt="" width={16} height={16} />
          </ButtonIcon>
          <ButtonText>{`${oauthActionLabel} with ${provider.label}`}</ButtonText>
        </LinkButton>
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
}: {
  capabilities: AuthCapabilities;
  submitLabel: string;
  action: "signIn" | "signUp";
}) {
  const navigate = useNavigate();
  const step = useAtomValue(authFormStepAtom);
  const setStep = useSetAtom(authFormStepAtom);
  const setStatus = useSetAtom(authFormStatusAtom);
  const setError = useSetAtom(authFormErrorAtom);
  const passwordRef = useRef<HTMLInputElement>(null);
  const credentialField = resolveCredentialField(capabilities);

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const credential = readFormFieldValue(formData, "credential");

    if (step === "email") {
      if (!credential) return;
      setStep("password");
      requestAnimationFrame(() => passwordRef.current?.focus());
      return;
    }

    const password = readFormFieldValue(formData, "password");
    if (!password) return;

    setStatus("loading");

    const authenticate = resolveAuthenticator(action);

    try {
      await authenticate(credential, password, capabilities);
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
      navigate({ to: "/verify-email" });
      return;
    }

    navigate({ to: "/dashboard" });
  };

  const handleBack = () => {
    setStep("email");
    setError(null);
  };

  return (
    <form onSubmit={handleSubmit} className="contents">
      <div className="flex flex-col gap-1.5">
        <CredentialInput
          readOnly={step === "password"}
          autoComplete={resolveAutoComplete(action, credentialField.autoComplete, capabilities)}
          label={credentialField.label}
          placeholder={credentialField.placeholder}
          type={credentialField.type}
        />
        <LazyMotion features={loadMotionFeatures}>
          <AnimatePresence>
            {step === "password" && (
              <m.div
                initial={{ height: 0, opacity: 0, overflow: "hidden" }}
                animate={{ height: "auto", opacity: 1, overflow: "visible" }}
                exit={{ height: 0, opacity: 0, overflow: "hidden" }}
                transition={{ duration: 0.2 }}
              >
                <PasswordInput
                  ref={passwordRef}
                  autoComplete={resolveAutoComplete(action, "current-password", capabilities)}
                />
              </m.div>
            )}
          </AnimatePresence>
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
  readOnly,
  autoComplete,
  label,
  onFocus,
  placeholder,
  type,
}: {
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
    <Input
      aria-label={label}
      name="credential"
      readOnly={readOnly}
      disabled={status === "loading"}
      type={type}
      placeholder={placeholder}
      autoComplete={autoComplete}
      tone={resolveInputTone(error?.active)}
      onChange={clearError}
      onFocus={onFocus}
    />
  );
}

function PasswordInput({ ref, autoComplete }: { ref?: Ref<HTMLInputElement>; autoComplete?: string }) {
  const status = useAtomValue(authFormStatusAtom);
  const error = useAtomValue(authFormErrorAtom);
  const setError = useSetAtom(authFormErrorAtom);

  const clearError = () => {
    if (error?.active) setError({ ...error, active: false });
  };

  return (
    <Input
      ref={ref}
      name="password"
      disabled={status === "loading"}
      type="password"
      placeholder="Password"
      autoComplete={autoComplete}
      tone={resolveInputTone(error?.active)}
      onChange={clearError}
    />
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
