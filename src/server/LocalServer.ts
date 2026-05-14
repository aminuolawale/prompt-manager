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

/**
 * Tiny HTTP server that receives post-commit and post-push git hook callbacks.
 * Each hook embeds a workspace ID (?ws=<id>) so multi-workspace setups route correctly.
 */
export class LocalServer {
  private server: http.Server;
  private port = 0;

  private commitHandlers: ((p: CommitHookPayload) => void)[] = [];
  private pushHandlers: ((p: PushHookPayload) => void)[] = [];

  constructor() {
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const url = new URL(req.url ?? '/', `http://127.0.0.1`);
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
        } catch { /* ignore malformed requests */ }

        res.writeHead(200).end('ok');
      });
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
      // Port 0 → OS picks a free port
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
}
