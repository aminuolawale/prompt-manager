import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as https from 'https';
import { UserInfo } from '../types';
import { LocalServer } from '../server/LocalServer';

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
}

/**
 * Google OAuth 2.0 with PKCE for VS Code extensions (desktop app flow).
 *
 * No client secret is required — PKCE replaces it. The client ID is the only
 * credential embedded in the extension, which is safe to distribute.
 *
 * Set up:
 *  1. Google Cloud Console → APIs & Services → Credentials
 *  2. Create OAuth 2.0 Client ID → Application type: Desktop app
 *  3. Copy the Client ID into promptTracker.googleClientId (settings.json)
 */
export class GoogleAuth {
  private static readonly SCOPES = 'openid email profile';
  private static readonly TOKEN_URL = 'https://oauth2.googleapis.com/token';
  private static readonly REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

  constructor(private server: LocalServer) {}

  private clientId(): string {
    const id = vscode.workspace
      .getConfiguration('promptTracker')
      .get<string>('googleClientId', '');
    if (!id) {
      throw new Error(
        'promptTracker.googleClientId is not set. ' +
          'See the README for how to create a Google OAuth Client ID.'
      );
    }
    return id;
  }

  async signIn(): Promise<{ user: UserInfo; refreshToken: string }> {
    const clientId = this.clientId();
    const port = this.server.getPort();
    const redirectUri = `http://127.0.0.1:${port}/auth/callback`;

    const verifier = this.generateVerifier();
    const challenge = this.generateChallenge(verifier);
    const state = crypto.randomBytes(16).toString('hex');

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GoogleAuth.SCOPES);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent'); // force refresh_token on every sign-in

    await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

    const code = await this.server.waitForAuthCallback(state);
    const tokens = await this.exchangeCode(code, verifier, redirectUri, clientId);
    const user = this.decodeIdToken(tokens.id_token);

    return { user, refreshToken: tokens.refresh_token ?? '' };
  }

  async refreshUser(refreshToken: string): Promise<UserInfo> {
    const clientId = this.clientId();
    const body = new URLSearchParams({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString();

    const tokens = await this.post<TokenResponse>(GoogleAuth.TOKEN_URL, body);
    return this.decodeIdToken(tokens.id_token);
  }

  async revokeToken(refreshToken: string): Promise<void> {
    const body = new URLSearchParams({ token: refreshToken }).toString();
    await this.post(GoogleAuth.REVOKE_URL, body).catch(() => {
      // Best-effort — user is signed out locally regardless
    });
  }

  // ── PKCE helpers ───────────────────────────────────────────────────────────

  private generateVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private generateChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  // ── Token exchange ─────────────────────────────────────────────────────────

  private exchangeCode(
    code: string,
    verifier: string,
    redirectUri: string,
    clientId: string
  ): Promise<TokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier
    }).toString();

    return this.post<TokenResponse>(GoogleAuth.TOKEN_URL, body);
  }

  private post<T>(url: string, body: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body)
          }
        },
        res => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(parsed.error_description ?? parsed.error ?? `HTTP ${res.statusCode}`));
              } else {
                resolve(parsed as T);
              }
            } catch {
              reject(new Error('Invalid JSON from Google'));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // ── ID token decode ────────────────────────────────────────────────────────
  // We received this token directly from Google over TLS — signature check not needed.

  private decodeIdToken(idToken: string): UserInfo {
    const payload = JSON.parse(
      Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')
    );
    return {
      id: payload.sub as string,
      email: payload.email as string,
      name: (payload.name ?? payload.email) as string,
      picture: (payload.picture ?? '') as string
    };
  }
}
