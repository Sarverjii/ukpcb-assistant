import argon2 from 'argon2';

// argon2id — the OWASP-recommended variant, resistant to both GPU
// (memory-hard) and side-channel attacks. Deliberately not bcrypt: bcrypt's
// fixed cost factor scales worse against modern GPU cracking than argon2's
// tunable memory cost.
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}
