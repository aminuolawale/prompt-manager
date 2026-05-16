import * as http from 'http';
import * as net from 'net';

export interface CommitHookPayload {
  workspaceId: string;
  hash: string;
  message: string;
  timestamp: string;
}

export interface PushHookPayload {
  workspaceId: string;
  remote: string;
  branch: string;
}

interface PendingAuth {
  state: string;
  resolve: (code: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Tiny HTTP server that receives:
 *  - POST /git/commit  — post-commit hook callbacks
 *  - POST /git/push    — post-push hook callbacks
 *  - GET  /auth/callback — Google OAuth redirect
 */
export class LocalServer {
  private server: http.Server;
  private port = 0;

  private commitHandlers: ((p: CommitHookPayload) => void)[] = [];
  private pushHandlers: ((p: PushHookPayload) => void)[] = [];
  private pendingAuth: PendingAuth | null = null;

  constructor() {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      // OAuth callback (GET)
      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        this.handleAuthCallback(url, res);
        return;
      }

      // Git hooks (POST)
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const wsId = url.searchParams.get('ws') ?? '';
          const params = new URLSearchParams(body);

          if (url.pathname === '/git/commit') {
            const payload: CommitHookPayload = {
              workspaceId: wsId,
              hash: params.get('hash') ?? '',
              message: decodeURIComponent(params.get('message') ?? ''),
              timestamp: params.get('timestamp') ?? new Date().toISOString()
            };
            if (payload.hash) this.commitHandlers.forEach(h => h(payload));
          } else if (url.pathname === '/git/push') {
            const payload: PushHookPayload = {
              workspaceId: wsId,
              remote: params.get('remote') ?? 'origin',
              branch: params.get('branch') ?? 'main'
            };
            this.pushHandlers.forEach(h => h(payload));
          }
        } catch { /* ignore malformed */ }

        res.writeHead(200).end('ok');
      });
    });
  }

  private handleAuthCallback(url: URL, res: http.ServerResponse): void {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    const pending = this.pendingAuth;

    if (!pending) {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(this.htmlPage(false, 'No pending sign-in.'));
      return;
    }

    clearTimeout(pending.timer);
    this.pendingAuth = null;

    if (error || !code || state !== pending.state) {
      pending.reject(new Error(error ?? 'Invalid OAuth callback'));
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(this.htmlPage(false, error ?? 'Sign-in failed.'));
    } else {
      pending.resolve(code);
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(this.htmlPage(true));
    }
  }

  /** Returns a Promise that resolves with the OAuth code when Google redirects back. */
  waitForAuthCallback(state: string, timeoutMs = 120_000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.pendingAuth) {
        clearTimeout(this.pendingAuth.timer);
        this.pendingAuth.reject(new Error('Superseded by new sign-in'));
      }

      const timer = setTimeout(() => {
        this.pendingAuth = null;
        reject(new Error('Sign-in timed out after 2 minutes'));
      }, timeoutMs);

      this.pendingAuth = { state, resolve, reject, timer };
    });
  }

  onCommit(handler: (p: CommitHookPayload) => void): void {
    this.commitHandlers.push(handler);
  }

  onPush(handler: (p: PushHookPayload) => void): void {
    this.pushHandlers.push(handler);
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.listen(0, '127.0.0.1', () => {
        this.port = (this.server.address() as net.AddressInfo).port;
        resolve(this.port);
      });
      this.server.on('error', reject);
    });
  }

  getPort(): number {
    return this.port;
  }

  stop(): void {
    this.server.close();
  }

  private htmlPage(success: boolean, message?: string): string {
    const title = success ? 'Signed in successfully' : 'Sign-in failed';
    const body = success
      ? 'You can close this tab and return to VS Code.'
      : `Something went wrong: ${message ?? 'unknown error'}. Close this tab and try again.`;
    const color = success ? '#2ea043' : '#d73a49';

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1117;color:#e6edf3}
.box{text-align:center;padding:40px;border-radius:8px;border:1px solid #30363d}
h1{color:${color};margin:0 0 12px}p{margin:0;opacity:.8}</style></head>
<body><div class="box"><h1>${title}</h1><p>${body}</p></div></body></html>`;
  }
}
