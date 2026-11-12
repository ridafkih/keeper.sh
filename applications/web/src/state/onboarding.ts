import { atom } from "jotai";
import type { OnboardingRun } from "@/features/onboarding/onboarding-step";

export const onboardingRunAtom = atom<OnboardingRun>({ phase: "idle" });

export const chosenDestinationIdAtom = atom<string | null>(null);
