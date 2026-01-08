import type { FC } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

interface SuperscriptLinkProps {
  href: string;
}

const SuperscriptLink: FC<SuperscriptLinkProps> = ({ href }) => (
  <Link
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex text-blue-500 hover:text-blue-600 align-super ml-0.5"
  >
    <ArrowUpRight size={10} />
  </Link>
);

export { SuperscriptLink };
