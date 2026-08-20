const nulSeparator = String.fromCodePoint(0);

const joinOnNul = (parts: readonly string[]): string => parts.join(nulSeparator);

export { joinOnNul, nulSeparator };
