export const loadMotionFeatures = () =>
  import("motion/react").then((mod) => mod.domAnimation);

export const loadMotionFeaturesMax = () =>
  import("motion/react").then((mod) => mod.domMax);
