import { Base32Error } from "../errors.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * RFC 4648 base32 as websites show it: any case, spaces anywhere, padding optional.
 * Errors name a position, never the text, so a mistyped secret is not echoed back.
 */
export function decode(text: string): Buffer {
  const clean = text.replace(/\s/g, "").toUpperCase();
  const data = clean.replace(/=+$/, "");

  if (data.length === 0) {
    throw new Base32Error("Invalid base32: the value is empty.");
  }
  if ([1, 3, 6].includes(data.length % 8)) {
    throw new Base32Error(`Invalid base32: ${data.length} characters is not a possible length (one is missing or extra).`);
  }
  if (clean.length > data.length && clean.length % 8 !== 0) {
    throw new Base32Error('Invalid base32: wrong amount of "=" padding.');
  }

  const out = Buffer.alloc(Math.floor((data.length * 5) / 8));
  let buffer = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < data.length; i++) {
    const value = ALPHABET.indexOf(data.charAt(i));
    if (value === -1) {
      throw new Base32Error(`Invalid base32 character at position ${i + 1}. Base32 uses the letters A-Z and the digits 2-7.`);
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = buffer >>> bits;
      buffer &= (1 << bits) - 1;
    }
  }
  return out;
}

/** Unpadded upper case, as otpauth URIs expect. */
export function encode(bytes: Uint8Array): string {
  let text = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      text += ALPHABET.charAt((buffer >>> bits) & 31);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0) {
    text += ALPHABET.charAt((buffer << (5 - bits)) & 31);
  }
  return text;
}
