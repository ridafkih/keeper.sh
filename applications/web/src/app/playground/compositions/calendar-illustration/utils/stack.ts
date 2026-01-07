import { createSkew, createIdentitySkew, type SkewTuple } from "./transforms";

export const getStackZIndex = (index: number, total: number, topIndex: number): number => {
  if (index === topIndex) return total;
  return index;
};

export const isTopOfStack = (index: number, topIndex: number): boolean => index === topIndex;

export const createBackLeftSkew = (intensity: number): SkewTuple => [
  createSkew(-12 * intensity, -24 * intensity, 12 * intensity),
  createSkew(-8 * intensity, -16 * intensity, 8 * intensity),
  createSkew(-3 * intensity, -8 * intensity, 4 * intensity),
];

export const createBackRightSkew = (intensity: number): SkewTuple => [
  createSkew(9 * intensity, 20 * intensity, -8 * intensity),
  createSkew(5 * intensity, 12 * intensity, -4 * intensity),
  createSkew(1.5 * intensity, 6 * intensity, -2 * intensity),
];

export const createFrontSkew = (intensity: number): SkewTuple => [
  createSkew(-4 * intensity, 4 * intensity, -6 * intensity),
  createSkew(-2 * intensity, 2 * intensity, -2 * intensity),
  createIdentitySkew(),
];
