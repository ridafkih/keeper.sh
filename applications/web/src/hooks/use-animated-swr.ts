import { useState } from "react";
import useSWR from "swr";
import type { SWRConfiguration, SWRResponse } from "swr";

interface AnimatedSWRResponse<T> extends SWRResponse<T> {
  shouldAnimate: boolean;
}

function useAnimatedSWR<T>(key: string, config?: SWRConfiguration<T>): AnimatedSWRResponse<T> {
  const response = useSWR<T>(key, config);
  const [shouldAnimate] = useState(response.isLoading);

  return { ...response, shouldAnimate };
}

export { useAnimatedSWR };
