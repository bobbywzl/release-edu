import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly",
          access_type: "offline",
          prompt: "select_account",
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        (session.user as { id?: string }).id = token.sub;
      }
      // Expose access token so client can call Google Drive API
      (session as { accessToken?: string }).accessToken = token.accessToken as string | undefined;
      // Expose role so the UI can show/hide admin affordances
      (session.user as { role?: string }).role = token.role as string | undefined;
      return session;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
      }
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
      }
      // Attach the DB role to the token so middleware can authorize /admin by
      // role (not just the ADMIN_EMAILS env list). Looked up only while missing,
      // so a freshly-promoted user picks it up on their next request. Non-fatal:
      // if the lookup fails or the user row doesn't exist yet, role stays unset
      // and they're treated as a normal student.
      if (token.email && !token.role) {
        try {
          const prisma = (await import("@/lib/prisma")).default;
          const dbUser = await prisma.user.findUnique({
            where: { email: token.email as string },
            select: { role: true },
          });
          if (dbUser?.role) token.role = dbUser.role;
        } catch {
          /* non-critical — role-based admin access falls back to ADMIN_EMAILS */
        }
      }
      return token;
    },
  },
};
