import { useState } from "react";

interface FormSubmitState<TResult> {
  isSubmitting: boolean;
  error: string | null;
  submit: (handler: () => Promise<TResult>) => Promise<TResult | null>;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useFormSubmit = <TResult = void>(): FormSubmitState<TResult> => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = (): void => setError(null);

  const submit = async (handler: () => Promise<TResult>): Promise<TResult | null> => {
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await handler();
      return result;
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      setError(error.message);
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  return { clearError, error, isSubmitting, setError, submit };
};
