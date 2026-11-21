export const ALGORITHMS = ["SHA1", "SHA256", "SHA512"] as const;
export type Algorithm = (typeof ALGORITHMS)[number];

export type Digits = 6 | 8;

export const DEFAULTS = { algorithm: "SHA1", digits: 6, period: 30 } as const;

export const MAX_PERIOD = 86_400;
