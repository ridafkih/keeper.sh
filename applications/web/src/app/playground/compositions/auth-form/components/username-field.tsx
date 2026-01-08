"use client";

import { FormField } from "../../../components/form-field";
import { useShowPasswordField } from "../contexts/auth-form-context";

export const UsernameField = () => {
  const showPasswordField = useShowPasswordField();

  return (
    <FormField
      name="username"
      type="text"
      placeholder="Username"
      required
      autoComplete="username"
      disabled={showPasswordField}
    />
  );
};
