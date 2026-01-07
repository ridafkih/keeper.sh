import type { TargetAndTransition } from "motion/react";

interface Skew extends TargetAndTransition {
  rotate: number;
  x: number;
  y: number;
}

type SkewTuple = [Skew, Skew, Skew];

const createSkew = (rotate: number, x: number, y: number): Skew => ({
  rotate,
  x,
  y,
});

const createIdentitySkew = (): Skew => ({ rotate: 0, x: 0, y: 0 });

const getInitialSkew = (skew: SkewTuple): Skew => skew[0];

const selectSkewByState = (skew: SkewTuple, emphasized: boolean): Skew => {
  if (emphasized) {
    return skew[2];
  }
  return skew[1];
};

type EasingTuple = readonly [number, number, number, number];

const getStandardEasing = (): EasingTuple => [0.16, 0.85, 0.2, 1];

const getTransitionConfig = (duration: number) => ({
  duration,
  ease: getStandardEasing(),
});

export { createSkew, createIdentitySkew, getInitialSkew, selectSkewByState, getTransitionConfig };

export type { SkewTuple };
