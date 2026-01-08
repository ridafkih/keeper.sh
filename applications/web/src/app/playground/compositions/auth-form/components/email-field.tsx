"use client";

import { FormField } from "../../../components/form-field";
import { useShowPasswordField } from "../contexts/auth-form-context";

export const EmailField = () => {
  const showPasswordField = useShowPasswordField();

  return (
    <FormField
      name="email"
      type="email"
      placeholder="Email"
      required
      autoComplete="email"
      disabled={showPasswordField}
    />
  );
};
