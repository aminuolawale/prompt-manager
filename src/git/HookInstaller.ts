import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const START_MARKER = '# prompt-session-tracker:start';
const END_MARKER = '# prompt-session-tracker:end';

export class HookInstaller {
  private installed = new Set<string>();

  /** Stable short ID for a workspace root used as the ?ws= query param. */
  static workspaceId(root: string): string {
    return crypto.createHash('sha256').update(root).digest('hex').slice(0, 12);
  }

  install(root: string, port: number): void {
    if (this.installed.has(root)) return;

    const hooksDir = path.join(root, '.git', 'hooks');
    if (!fs.existsSync(hooksDir)) return;

    const wsId = HookInstaller.workspaceId(root);
    this.installHook(hooksDir, 'post-commit', this.postCommitScript(port, wsId));
    this.installHook(hooksDir, 'post-push', this.postPushScript(port, wsId));
    this.installed.add(root);
  }

  private installHook(dir: string, name: string, block: string): void {
    const hookPath = path.join(dir, name);

    if (fs.existsSync(hookPath)) {
      const existing = fs.readFileSync(hookPath, 'utf8');
      if (existing.includes(START_MARKER)) return; // already installed
      fs.appendFileSync(hookPath, `\n${block}\n`);
    } else {
      fs.writeFileSync(hookPath, `#!/bin/sh\n${block}\n`);
      fs.chmodSync(hookPath, '755');
    }
  }

  uninstall(root: string): void {
    const hooksDir = path.join(root, '.git', 'hooks');
    if (!fs.existsSync(hooksDir)) return;

    for (const name of ['post-commit', 'post-push']) {
      const hookPath = path.join(hooksDir, name);
      if (!fs.existsSync(hookPath)) continue;

      const content = fs.readFileSync(hookPath, 'utf8');
      if (!content.includes(START_MARKER)) continue;

      const cleaned = this.removeBlock(content);
      const trimmed = cleaned.trim();

      if (!trimmed || trimmed === '#!/bin/sh') {
        fs.unlinkSync(hookPath);
      } else {
        fs.writeFileSync(hookPath, trimmed + '\n');
      }
    }

    this.installed.delete(root);
  }

  private removeBlock(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let inside = false;

    for (const line of lines) {
      if (line.trim() === START_MARKER) { inside = true; continue; }
      if (line.trim() === END_MARKER) { inside = false; continue; }
      if (!inside) result.push(line);
    }

    return result.join('\n');
  }

  uninstallAll(): void {
    for (const root of [...this.installed]) this.uninstall(root);
  }

  private postCommitScript(port: number, wsId: string): string {
    return `${START_MARKER}
HASH=$(git log -1 --format="%H")
MSG=$(git log -1 --format="%s" | head -c 500)
TS=$(git log -1 --format="%ai")
curl -sf "http://127.0.0.1:${port}/git/commit?ws=${wsId}" \\
  -X POST --max-time 2 \\
  -d "hash=$HASH&timestamp=$TS&message=$(printf '%s' "$MSG" | od -An -tx1 | tr -d ' \\n' | sed 's/../%&/g')" >/dev/null 2>&1 &
${END_MARKER}`;
  }

  private postPushScript(port: number, wsId: string): string {
    return `${START_MARKER}
curl -sf "http://127.0.0.1:${port}/git/push?ws=${wsId}" \\
  -X POST --max-time 2 \\
  -d "remote=$1&branch=$2" >/dev/null 2>&1 &
${END_MARKER}`;
  }
}
