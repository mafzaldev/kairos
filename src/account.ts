import type { Algorithm, Digits } from "./otp/types.js";

export interface Account {
  name: string;
  issuer: string;
  secret: Buffer;
  algorithm: Algorithm;
  digits: Digits;
  period: number;
}

/** "Issuer:name", the form otpauth URIs use. */
export function label({ name, issuer }: Pick<Account, "name" | "issuer">): string {
  return issuer ? `${issuer}:${name}` : name;
}
