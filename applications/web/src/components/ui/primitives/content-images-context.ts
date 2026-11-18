import { createContext } from "react";
import type { ContentImage } from "@/lib/blog-posts";

export const ContentImagesContext = createContext<ContentImage[]>([]);
