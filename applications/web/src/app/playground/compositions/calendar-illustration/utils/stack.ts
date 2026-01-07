import { createSkew, createIdentitySkew, type SkewTuple } from "./transforms";

const createBackLeftSkew = (intensity: number): SkewTuple => [
  createSkew(-12 * intensity, -24 * intensity, 12 * intensity),
  createSkew(-8 * intensity, -16 * intensity, 8 * intensity),
  createSkew(-3 * intensity, -8 * intensity, 4 * intensity),
];

const createBackRightSkew = (intensity: number): SkewTuple => [
  createSkew(9 * intensity, 20 * intensity, -8 * intensity),
  createSkew(5 * intensity, 12 * intensity, -4 * intensity),
  createSkew(1.5 * intensity, 6 * intensity, -2 * intensity),
];

const createFrontSkew = (intensity: number): SkewTuple => [
  createSkew(-4 * intensity, 4 * intensity, -6 * intensity),
  createSkew(-2 * intensity, 2 * intensity, -2 * intensity),
  createIdentitySkew(),
];

export { createBackLeftSkew, createBackRightSkew, createFrontSkew };
