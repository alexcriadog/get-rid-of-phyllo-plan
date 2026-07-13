import { describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { parseOperatorUsers, verifyOperator } from '../operator-users';

const hash = bcrypt.hashSync('s3cret', 8);
const RAW = JSON.stringify([
  { email: 'Alex@Camaleonic.com', name: 'Alex', passwordHash: hash },
]);

describe('parseOperatorUsers', () => {
  it('returns [] for undefined or blank', () => {
    expect(parseOperatorUsers(undefined)).toEqual([]);
    expect(parseOperatorUsers('   ')).toEqual([]);
  });
  it('returns [] for malformed JSON instead of throwing', () => {
    expect(parseOperatorUsers('{not json')).toEqual([]);
  });
  it('parses a valid array', () => {
    const users = parseOperatorUsers(RAW);
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('Alex@Camaleonic.com');
  });
});

describe('verifyOperator', () => {
  it('matches by case-insensitive email + correct password', async () => {
    const users = parseOperatorUsers(RAW);
    const u = await verifyOperator('alex@camaleonic.com', 's3cret', users);
    expect(u?.name).toBe('Alex');
  });
  it('returns null on wrong password', async () => {
    const users = parseOperatorUsers(RAW);
    expect(await verifyOperator('alex@camaleonic.com', 'nope', users)).toBeNull();
  });
  it('returns null on unknown email', async () => {
    const users = parseOperatorUsers(RAW);
    expect(await verifyOperator('ghost@x.com', 's3cret', users)).toBeNull();
  });
});
