import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import type { Account } from "../account.js";
import { WrongPasswordError } from "../errors.js";
import { IV_SIZE, SALT_SIZE, TAG_SIZE, deserialize, header, pack, serialize, unpack, type ScryptParams } from "./format.js";

const CIPHER = "aes-256-gcm";

/** A derived key, with what is needed to derive it again from the password. */
export interface Key {
  bytes: Buffer;
  salt: Buffer;
  params: ScryptParams;
}

function derive(password: Buffer, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const N = 2 ** params.logN;
  // scrypt needs about 128 * N * r bytes; Node's default limit is 32 MiB.
  const options = { N, r: params.r, p: params.p, maxmem: 256 * N * params.r };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function newKey(password: Buffer, params: ScryptParams): Promise<Key> {
  const salt = randomBytes(SALT_SIZE);
  return { bytes: await derive(password, salt, params), salt, params };
}

/** Encrypts the accounts into a complete vault file. Every call uses a fresh IV. */
export function seal(key: Key, accounts: readonly Account[]): Buffer {
  const iv = randomBytes(IV_SIZE);
  const head = header(key.params, key.salt, iv);
  const plaintext = serialize(accounts);
  try {
    const cipher = createCipheriv(CIPHER, key.bytes, iv, {
      authTagLength: TAG_SIZE,
    });
    cipher.setAAD(head);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return pack(head, cipher.getAuthTag(), ciphertext);
  } finally {
    plaintext.fill(0);
  }
}

/**
 * Decrypts a vault file with a password, or with a key derived earlier. A key
 * only fits a file sealed with the same salt and parameters.
 */
export async function open(file: Buffer, secret: Buffer | Key): Promise<{ key: Key; accounts: Account[] }> {
  const { params, salt, iv, head, tag, ciphertext } = unpack(file);

  let bytes: Buffer;
  if (Buffer.isBuffer(secret)) {
    bytes = await derive(secret, salt, params);
  } else {
    const fits = secret.salt.equals(salt) && secret.params.logN === params.logN && secret.params.r === params.r && secret.params.p === params.p;
    if (!fits) throw new WrongPasswordError();
    bytes = Buffer.from(secret.bytes);
  }

  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv(CIPHER, bytes, iv, {
      authTagLength: TAG_SIZE,
    });
    decipher.setAAD(head);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // The checksum matched, so the file is intact: the key must be wrong.
    bytes.fill(0);
    throw new WrongPasswordError();
  }

  try {
    return {
      key: { bytes, salt: Buffer.from(salt), params },
      accounts: deserialize(plaintext),
    };
  } catch (error) {
    bytes.fill(0);
    throw error;
  } finally {
    plaintext.fill(0);
  }
}
