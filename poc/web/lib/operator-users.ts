import bcrypt from 'bcryptjs';
import { z } from 'zod';

export interface OperatorUser {
  email: string;
  name: string;
  passwordHash: string;
}

const schema = z.array(
  z.object({
    email: z.string().min(1),
    name: z.string().min(1),
    passwordHash: z.string().min(1),
  }),
);

/** Parse the OPERATOR_USERS env JSON. Never throws — bad input → []. */
export function parseOperatorUsers(raw: string | undefined): OperatorUser[] {
  if (!raw || raw.trim().length === 0) return [];
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

// A well-formed bcrypt hash of a random value, compared against on the
// email-not-found path so that timing does not reveal whether an operator
// email exists (bcrypt.compare dominates the response time either way).
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8DL.k0k1a5kQ0i6kQ0i6kQ0i6kQ0i6';

/** Case-insensitive email lookup + bcrypt compare, with a dummy compare on
 *  miss to blunt user-enumeration timing. */
export async function verifyOperator(
  email: string,
  password: string,
  users: OperatorUser[],
): Promise<OperatorUser | null> {
  const target = email.trim().toLowerCase();
  const user = users.find((u) => u.email.toLowerCase() === target);
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    return null;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}
