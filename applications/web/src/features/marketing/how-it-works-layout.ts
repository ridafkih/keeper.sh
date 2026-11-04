/**
 * The steps the homepage and /features lay out, in order, each with its own
 * illustration. Every step needs copy from the marketing collection. The
 * default copy is derived from this list, so it always covers it.
 */
export const HOW_IT_WORKS_STEP_IDS = ["connect", "configure", "sync"] as const;

type HowItWorksStepId = (typeof HOW_IT_WORKS_STEP_IDS)[number];

interface HowItWorksStep {
  title: string;
  body: string;
  note?: string;
}

interface HowItWorksStepCopy extends HowItWorksStep {
  id: string;
}

export function resolveHowItWorksSteps(
  steps: readonly HowItWorksStepCopy[],
): Record<HowItWorksStepId, HowItWorksStep> {
  const copyById = new Map(steps.map((step) => [step.id, step] as const));

  const entries = HOW_IT_WORKS_STEP_IDS.map((id) => {
    const copy = copyById.get(id);

    if (!copy) {
      throw new Error(`How-it-works step "${id}" has no copy in the marketing collection.`);
    }

    const step: HowItWorksStep = {
      title: copy.title,
      body: copy.body,
      ...(copy.note ? { note: copy.note } : {}),
    };

    return [id, step] as const;
  });

  return Object.fromEntries(entries) as Record<HowItWorksStepId, HowItWorksStep>;
}
