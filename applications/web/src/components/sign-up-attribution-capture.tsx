import { useEffect } from "react";
import { rememberThisVisit } from "@/lib/sign-up-attribution";

function SignUpAttributionCapture() {
  useEffect(() => {
    rememberThisVisit();
  }, []);

  return null;
}

export { SignUpAttributionCapture };
