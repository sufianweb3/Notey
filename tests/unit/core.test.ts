import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/shared/ids';
import { hashPassword, verifyPassword } from '../../src/server/auth/password';
import { assertSafeKey } from '../../src/server/storage';

describe('uuidv7', () => {
  it('is a version 7, variant 10 UUID', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('sorts by creation time', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    const c = uuidv7(1_800_000_000_000);
    expect([c, a, b].sort()).toEqual([a, b, c]);
  });

  it('encodes the timestamp in the first 48 bits', () => {
    const t = 1_763_856_000_000;
    const hex = uuidv7(t).replace(/-/g, '').slice(0, 12);
    expect(parseInt(hex, 16)).toBe(t);
  });
});

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('pbkdf2_sha256$100000$')).toBe(true);
    expect(await verifyPassword({ hash, password: 'correct horse battery' })).toBe(true);
    expect(await verifyPassword({ hash, password: 'correct horse batterY' })).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects malformed or downgraded hashes', async () => {
    expect(await verifyPassword({ hash: 'scrypt$abc', password: 'x' })).toBe(false);
    expect(await verifyPassword({ hash: 'pbkdf2_sha256$9999999$AA==$AA==', password: 'x' })).toBe(false);
  });
});

describe('storage keys', () => {
  it.each(['ws/abc/file.png', 'selftest/1.txt'])('accepts %s', (k) => {
    expect(() => assertSafeKey(k)).not.toThrow();
  });
  it.each(['../etc/passwd', '/abs', 'a/../b', 'a//b', '', 'a\\b'])('rejects %s', (k) => {
    expect(() => assertSafeKey(k)).toThrow();
  });
});
