import createBezier from "bezier-easing";

export const bezier = createBezier;
export const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));

// Stable string hashing and Mulberry32 keep existing procedural particles in place.
export const seededRandom = seed => {
  let hash = typeof seed === "number" ? seed * 10000000000 : 0;
  if (typeof seed === "string") for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(index)) | 0;
  }
  let value = hash + 0x6d2b79f5;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
};

export const interpolate = (value, input, output, options = {}) => {
  if (input.length < 2 || input.length !== output.length
    || input.some((item, index) => !Number.isFinite(item) || index > 0 && item <= input[index - 1])) {
    throw new Error("插值需要等长数值数组和递增的输入范围");
  }
  if (value < input[0]) {
    if (options.extrapolateLeft === "identity") return value;
    if (options.extrapolateLeft === "clamp") value = input[0];
  }
  if (value > input.at(-1)) {
    if (options.extrapolateRight === "identity") return value;
    if (options.extrapolateRight === "clamp") value = input.at(-1);
  }
  let index = 0;
  while (index < input.length - 2 && value >= input[index + 1]) index += 1;
  const progress = (value - input[index]) / (input[index + 1] - input[index]);
  return output[index] + (output[index + 1] - output[index]) * (options.easing ?? (x => x))(progress);
};
