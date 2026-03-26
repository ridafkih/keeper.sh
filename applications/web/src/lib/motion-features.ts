export const loadMotionFeatures = () =>
  import("motion/react").then((mod) => mod.domMax);
