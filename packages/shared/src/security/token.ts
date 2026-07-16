import { timingSafeEqual } from "node:crypto";
import argon2 from "argon2";

export interface SecretConfig {
  token?: string;
  tokenHash?: string;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export async function verifySecret(secret: SecretConfig, candidate: string): Promise<boolean> {
  if (secret.tokenHash) {
    if (secret.tokenHash.startsWith("$argon2")) {
      return argon2.verify(secret.tokenHash, candidate);
    }
    return safeEqual(secret.tokenHash, candidate);
  }

  if (secret.token) {
    return safeEqual(secret.token, candidate);
  }

  return false;
}
