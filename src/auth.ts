import NextAuth, { type DefaultSession } from 'next-auth';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import type { JWT } from 'next-auth/jwt';

// Extend the built-in session types...
declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    error?: 'RefreshAccessTokenError';
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    error?: 'RefreshAccessTokenError';
    name?: string;
    email?: string;
  }
}

// Use placeholder values during build if env vars are not set
// This allows the build to succeed; actual auth will fail at runtime without real values
const tenantId = process.env.ENTRA_TENANT_ID || 'placeholder';
const tenantName = process.env.ENTRA_TENANT_NAME || 'placeholder';

// Azure returns tenant ID in issuer, but we use tenant name for auth/token endpoints
const issuerBaseUrl = `https://${tenantId}.ciamlogin.com/${tenantId}`;
const authBaseUrl = `https://${tenantName}.ciamlogin.com/${tenantId}`;

const entraConfig = {
  clientId: process.env.ENTRA_CLIENT_ID || 'placeholder',
  clientSecret: process.env.ENTRA_CLIENT_SECRET || 'placeholder',
  issuer: `${issuerBaseUrl}/v2.0`,
  scope: process.env.ENTRA_SCOPES || 'openid profile email',
  sessionMaxAge: parseInt(process.env.AUTH_SESSION_MAX_AGE || '86400', 10),
  defaultTokenExpiry: parseInt(
    process.env.AUTH_DEFAULT_TOKEN_EXPIRY || '3600',
    10,
  ),
};

const tokenUrl = `${authBaseUrl}/oauth2/v2.0/token`;
const authUrl = `${authBaseUrl}/oauth2/v2.0/authorize`;

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const response = await fetch(tokenUrl, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      body: new URLSearchParams({
        client_id: entraConfig.clientId,
        client_secret: entraConfig.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken!,
      }),
    });

    const refreshedTokens = await response.json();

    if (!response.ok) {
      throw refreshedTokens;
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken, // Fall back to old refresh token
    };
  } catch (error) {
    console.error('Error refreshing access token:', error);
    return {
      ...token,
      error: 'RefreshAccessTokenError',
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: entraConfig.clientId,
      clientSecret: entraConfig.clientSecret,
      issuer: entraConfig.issuer,
      token: tokenUrl,
      authorization: {
        url: authUrl,
        params: {
          scope: entraConfig.scope,
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      // Initial sign in
      if (account && user) {
        const newToken = {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at
            ? account.expires_at * 1000
            : Date.now() + entraConfig.defaultTokenExpiry * 1000,
          // Extract user profile claims from ID token
          name: user.name ?? undefined,
          email: user.email ?? undefined,
          // To (2 minutes for testing):
          // accessTokenExpires: Date.now() + 2 * 60 * 1000, // 2 minute - for testing refresh token
        };
        return newToken;
      }

      // Return previous token if the access token has not expired yet
      if (token.accessTokenExpires && Date.now() < token.accessTokenExpires) {
        return token;
      }

      // Access token has expired, try to refresh it
      if (token.refreshToken) {
        return refreshAccessToken(token);
      }

      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub!;

      // Expose name and email from JWT token (extracted from ID token during sign-in)
      if (token.name) session.user.name = token.name;
      if (token.email) session.user.email = token.email;

      // Only include error status if token refresh failed
      if (token.error) {
        session.error = token.error;
      }

      // Note: accessToken is NOT included here - it stays server-side only in the JWT cookie.
      // Server-side code uses getServerAccessToken() which decodes the JWT directly.

      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: entraConfig.sessionMaxAge,
  },
  pages: {
    signIn: '/',
    error: '/auth/error',
  },
});
