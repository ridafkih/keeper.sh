import { atom } from "jotai";

export type AuthFormStatus = "idle" | "loading";
export type AuthFormStep = "email" | "password";

export const authFormStatusAtom = atom<AuthFormStatus>("idle");
authFormStatusAtom.onMount = (set) => () => set("idle");

export const authFormStepAtom = atom<AuthFormStep>("email");
authFormStepAtom.onMount = (set) => () => set("email");

type AuthFormError = {
  message: string;
  active: boolean;
} | null;

export const authFormErrorAtom = atom<AuthFormError>(null);
authFormErrorAtom.onMount = (set) => () => set(null);
