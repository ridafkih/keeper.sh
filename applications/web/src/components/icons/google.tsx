import type { FC } from "react";
import Image from "next/image";

interface GoogleIconProps {
  className?: string;
}

export const GoogleIcon: FC<GoogleIconProps> = ({ className }) => (
  <Image src="/integrations/icon-google.svg" alt="" width={16} height={16} className={className} />
);
