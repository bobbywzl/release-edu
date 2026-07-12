import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

// ── Vercel PREVIEW deployments: pin OAuth to the STABLE branch URL ──
// Without NEXTAUTH_URL, NextAuth v4 falls back to VERCEL_URL — the
// per-deployment hash URL (release-edu-<hash>-….vercel.app) that changes on
// every build, so the Google callback it sends can never be pre-authorized
// → "Error 400: redirect_uri_mismatch" on every preview. VERCEL_BRANCH_URL
// is one constant alias per branch, so it CAN be added to the Google OAuth
// client's Authorized redirect URIs once (…/api/auth/callback/google — the
// preview login page shows the exact string to copy). Production is
// untouched: there NEXTAUTH_URL is set / VERCEL_ENV !== "preview".
// src/middleware.ts redirects preview traffic onto this same host so the
// OAuth state cookie and the callback always share a domain.
if (
  !process.env.NEXTAUTH_URL &&
  process.env.VERCEL_ENV === "preview" &&
  process.env.VERCEL_BRANCH_URL
) {
  process.env.NEXTAUTH_URL = `https://${process.env.VERCEL_BRANCH_URL}`;
}

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
      // Resolve admin status onto the token so middleware can gate /admin by
      // EMAIL (the second factor alongside the password). A caller is an admin
      // if their email is in the ADMIN_EMAILS env bootstrap list, OR their DB
      // role is "admin", OR their email is in the editable AdminEmail allow-list.
      // Recomputed when missing so a freshly-added admin picks it up on their
      // next sign-in. Non-fatal: on error, falls back to the env check in
      // middleware so the owner is never locked out.
      if (token.email && token.isAdmin === undefined) {
        try {
          const prisma = (await import("@/lib/prisma")).default;
          const email = (token.email as string).toLowerCase();
          const envAdmins = (process.env.ADMIN_EMAILS || "")
            .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
          let admin = envAdmins.includes(email);
          const dbUser = await prisma.user.findUnique({
            where: { email: token.email as string },
            select: { role: true },
          });
          if (dbUser?.role) token.role = dbUser.role;
          if (!admin && dbUser?.role === "admin") admin = true;
          if (!admin) {
            const allow = await prisma.adminEmail.findUnique({
              where: { email }, select: { id: true },
            });
            if (allow) admin = true;
          }
          token.isAdmin = admin;
        } catch {
          /* non-critical — middleware falls back to the ADMIN_EMAILS env check */
        }
      }
      return token;
    },
  },
};
