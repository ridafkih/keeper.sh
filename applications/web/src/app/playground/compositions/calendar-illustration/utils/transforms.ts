export type Skew = {
  rotate: number;
  x: number;
  y: number;
};

export type SkewTuple = [Skew, Skew, Skew];

export const createSkew = (rotate: number, x: number, y: number): Skew => ({
  rotate,
  x,
  y,
});

export const createIdentitySkew = (): Skew => ({ rotate: 0, x: 0, y: 0 });

export const lerpSkew = (from: Skew, to: Skew, progress: number): Skew => ({
  rotate: from.rotate + (to.rotate - from.rotate) * progress,
  x: from.x + (to.x - from.x) * progress,
  y: from.y + (to.y - from.y) * progress,
});

export const createSkewTuple = (initial: Skew, base: Skew, hover: Skew): SkewTuple => [
  initial,
  base,
  hover,
];

export const getInitialSkew = (skew: SkewTuple): Skew => skew[0];

export const getBaseSkew = (skew: SkewTuple): Skew => skew[1];

export const getHoverSkew = (skew: SkewTuple): Skew => skew[2];

export const selectSkewByState = (skew: SkewTuple, emphasized: boolean): Skew => {
  if (emphasized) return skew[2];
  return skew[1];
};

export const skewToTransformStyle = (skew: Skew): string =>
  `rotate(${skew.rotate}deg) translateX(${skew.x}px) translateY(${skew.y}px)`;

export type EasingTuple = readonly [number, number, number, number];

export const getStandardEasing = (): EasingTuple => [0.16, 0.85, 0.2, 1];

export const getTransitionConfig = (duration: number) => ({
  duration,
  ease: getStandardEasing(),
});
