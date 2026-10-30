/**
 * Deterministic Content & Multiset Hashing.
 * Conforms to SPEC-MOD-02 & SPEC-MOD-07 for reproducible artifact identification.
 */

import { serializeDeterministic } from "../contracts/index";

/**
 * Pure TypeScript SHA-256 implementation ensuring universal availability
 * across all environments (Browser main thread, Web Worker, Node.js, Vitest).
 */
function sha256Sync(bytes: Uint8Array): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const originalLength = bytes.length;
  const bitLength = originalLength * 8;
  const withOne = new Uint8Array(originalLength + 1);
  withOne.set(bytes);
  withOne[originalLength] = 0x80;

  const padLength = (withOne.length % 64 <= 56)
    ? 56 - (withOne.length % 64)
    : 120 - (withOne.length % 64);
  const totalLength = withOne.length + padLength + 8;
  const padded = new Uint8Array(totalLength);
  padded.set(withOne);

  const view = new DataView(padded.buffer);
  view.setBigUint64(totalLength - 8, BigInt(bitLength), false);

  const words = new Uint32Array(64);

  for (let i = 0; i < totalLength; i += 64) {
    for (let j = 0; j < 16; j++) {
      words[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 64; j++) {
      const s0 = rightRotate(words[j - 15], 7) ^ rightRotate(words[j - 15], 18) ^ (words[j - 15] >>> 3);
      const s1 = rightRotate(words[j - 2], 17) ^ rightRotate(words[j - 2], 19) ^ (words[j - 2] >>> 10);
      words[j] = (words[j - 16] + s0 + words[j - 7] + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let j = 0; j < 64; j++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[j] + words[j]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const parts = [h0, h1, h2, h3, h4, h5, h6, h7].map((num) =>
    (num >>> 0).toString(16).padStart(8, "0")
  );
  return parts.join("");
}

/**
 * Computes SHA-256 hash of a string or byte array.
 * Uses Web Crypto if available, falling back to pure TS SHA-256.
 */
export async function computeSha256(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;

  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle?.digest) {
    try {
      const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // Fallback to sync implementation on subtle crypto failure
    }
  }

  return sha256Sync(bytes);
}

/**
 * Synchronous SHA-256 hash.
 */
export function computeSha256Sync(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return sha256Sync(bytes);
}

/**
 * Computes deterministic content hash of dataset rows.
 */
export async function computeContentHash(rows: Record<string, unknown>[]): Promise<string> {
  const serialized = serializeDeterministic(rows);
  return computeSha256(serialized);
}

const TWO_POW_256 = BigInt(1) << BigInt(256);

/**
 * Computes order-independent multiset hash of dataset rows.
 *
 * Algorithm:
 * 1. For each row: serialize deterministically and compute 256-bit SHA-256 hash.
 * 2. Sum all row hashes as 256-bit BigInts modulo 2^256.
 * 3. Format resulting 256-bit sum as a 64-character lowercase hex string.
 *
 * Mathematical property: Commutativity of addition guarantees:
 * multisetHash(R1, R2) === multisetHash(R2, R1).
 */
export async function computeMultisetHash(rows: Record<string, unknown>[]): Promise<string> {
  if (!rows || rows.length === 0) {
    return "0".repeat(64);
  }

  let sum = BigInt(0);

  for (const row of rows) {
    const serialized = serializeDeterministic(row);
    const rowHex = computeSha256Sync(serialized);
    const rowBigInt = BigInt("0x" + rowHex);
    sum = (sum + rowBigInt) % TWO_POW_256;
  }

  return sum.toString(16).padStart(64, "0");
}

/**
 * Computes deterministic step definition hash.
 * Incorporates operation type, parameters, and upstream inputs' hashes.
 */
export async function computeStepDefinitionHash(
  operationType: string,
  parameters: Record<string, unknown>,
  inputHashes: string[]
): Promise<string> {
  const definition = {
    operationType,
    parameters,
    inputHashes: [...inputHashes].sort(),
  };
  const serialized = serializeDeterministic(definition);
  return computeSha256(serialized);
}
