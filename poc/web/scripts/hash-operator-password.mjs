// Usage: node scripts/hash-operator-password.mjs 'plaintext-password'
// Prints a bcrypt hash to paste into OPERATOR_USERS[].passwordHash.
import bcrypt from 'bcryptjs';

const pw = process.argv[2];
if (!pw) {
  console.error("usage: node scripts/hash-operator-password.mjs '<password>'");
  process.exit(1);
}
console.log(bcrypt.hashSync(pw, 10));
