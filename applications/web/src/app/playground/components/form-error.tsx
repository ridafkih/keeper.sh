import type { FC } from "react";

interface FormErrorProps {
  message: string | null;
}

const FormError: FC<FormErrorProps> = ({ message }) => {
  if (!message) {
    return null;
  }

  return (
    <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-200">
      <span className="text-sm text-red-700">{message}</span>
    </div>
  );
};

export { FormError };
