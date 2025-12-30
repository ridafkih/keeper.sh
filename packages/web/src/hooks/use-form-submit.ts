import { useState } from "react";

interface FormSubmitState<TResult> {
  isSubmitting: boolean;
  error: string | null;
  submit: (handler: () => Promise<TResult>) => Promise<TResult | undefined>;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export function useFormSubmit<TResult = void>(): FormSubmitState<TResult> {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  const submit = async (
    handler: () => Promise<TResult>,
  ): Promise<TResult | undefined> => {
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await handler();
      return result;
    } catch (thrown) {
      if (!(thrown instanceof Error)) throw thrown;
      setError(thrown.message);
      return undefined;
    } finally {
      setIsSubmitting(false);
    }
  };

  return { isSubmitting, error, submit, setError, clearError };
}
