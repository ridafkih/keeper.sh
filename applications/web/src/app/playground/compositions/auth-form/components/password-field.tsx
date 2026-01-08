"use client";

import { FC, HTMLProps } from "react";
import { FormField } from "../../../components/form-field";
import { useShowPasswordField } from "../contexts/auth-form-context";
import { AnimatePresence, motion } from "motion/react";

export const PasswordField: FC<HTMLProps<HTMLInputElement>> = ({ ...props }) => {
  const showPasswordField = useShowPasswordField();

  return (
    <AnimatePresence>
      {showPasswordField && (
        <motion.div
          transition={{ duration: 0.16, opacity: { delay: 0.16 } }}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1}}
          className="flex flex-col justify-end"
        >
          <FormField
            name="password"
            required
            autoFocus
            minLength={8}
            type={props.type}
            autoComplete={props.autoComplete}
            placeholder="Password"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
