import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { parseOperatorUsers, verifyOperator } from './lib/operator-users';

const SEVEN_DAYS = 60 * 60 * 24 * 7;

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: SEVEN_DAYS },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const email = typeof creds?.email === 'string' ? creds.email : '';
        const password =
          typeof creds?.password === 'string' ? creds.password : '';
        if (!email || !password) return null;
        const users = parseOperatorUsers(process.env.OPERATOR_USERS);
        const user = await verifyOperator(email, password, users);
        if (!user) return null;
        return { id: user.email, email: user.email, name: user.name };
      },
    }),
  ],
});
