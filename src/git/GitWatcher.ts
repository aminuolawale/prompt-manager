import * as vscode from 'vscode';
import * as cp from 'child_process';
import { GitExtension, GitAPI, Repository } from './GitTypes';
import { CommitInfo, PushInfo } from '../types';

export type CommitHandler = (workspaceRoot: string, commit: CommitInfo) => void;
export type PushHandler = (workspaceRoot: string, push: PushInfo) => Promise<void>;

export class GitWatcher {
  private api: GitAPI | null = null;
  private disposables: { dispose(): void }[] = [];

  // Track last-known state per repo to detect changes
  private prevLocalHead = new Map<string, string>();
  private prevRemoteHead = new Map<string, string>();

  // Suppress double-firing when both hook and state change fire for the same event
  private recentCommits = new Set<string>();
  private recentPushes = new Set<string>();

  constructor(
    private onCommit: CommitHandler,
    private onPush: PushHandler
  ) {}

  async initialize(): Promise<void> {
    const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!ext) return;

    const gitExt = ext.isActive ? ext.exports : await ext.activate();
    this.api = gitExt.getAPI(1);

    for (const repo of this.api.repositories) this.watchRepo(repo);
    this.disposables.push(this.api.onDidOpenRepository(r => this.watchRepo(r)));
  }

  private watchRepo(repo: Repository): void {
    const root = repo.rootUri.fsPath;
    this.snapshotState(root, repo);

    const sub = repo.state.onDidChange(async () => {
      const localHead = repo.state.HEAD?.commit;
      const prevLocal = this.prevLocalHead.get(root);

      // New local commit
      if (localHead && localHead !== prevLocal) {
        this.prevLocalHead.set(root, localHead);
        if (!this.recentCommits.has(localHead)) {
          this.recentCommits.add(localHead);
          setTimeout(() => this.recentCommits.delete(localHead), 5000);
          const info = await this.fetchCommitInfo(root, localHead);
          if (info) this.onCommit(root, info);
        }
      }

      // Push: remote tracking ref advanced
      const remoteHead = this.getRemoteHead(repo);
      const prevRemote = this.prevRemoteHead.get(root);
      if (remoteHead && remoteHead !== prevRemote) {
        this.prevRemoteHead.set(root, remoteHead);
        const pushKey = `${root}:${remoteHead}`;
        if (!this.recentPushes.has(pushKey)) {
          this.recentPushes.add(pushKey);
          setTimeout(() => this.recentPushes.delete(pushKey), 5000);
          const count = await this.countCommits(root, prevRemote ?? null, remoteHead);
          await this.onPush(root, {
            timestamp: new Date().toISOString(),
            remote: repo.state.HEAD?.upstream?.remote ?? 'origin',
            branch: repo.state.HEAD?.name ?? 'main',
            commitCount: count
          });
        }
      }
    });

    this.disposables.push(sub);
  }

  private snapshotState(root: string, repo: Repository): void {
    if (repo.state.HEAD?.commit) {
      this.prevLocalHead.set(root, repo.state.HEAD.commit);
    }
    const rh = this.getRemoteHead(repo);
    if (rh) this.prevRemoteHead.set(root, rh);
  }

  private getRemoteHead(repo: Repository): string | null {
    const upstream = repo.state.HEAD?.upstream;
    if (!upstream) return null;
    const ref = repo.state.refs.find(
      r => r.type === 1 && r.name === `${upstream.remote}/${upstream.name}`
    );
    return ref?.commit ?? null;
  }

  private fetchCommitInfo(root: string, hash: string): Promise<CommitInfo | null> {
    return new Promise(resolve => {
      cp.exec(
        `git log -1 --format="%H%n%s%n%ai%n%D" ${hash}`,
        { cwd: root },
        (err, stdout) => {
          if (err) { resolve(null); return; }
          const [commitHash, message, timestamp, refs] = stdout.trim().split('\n');
          const branchMatch = refs?.match(/HEAD -> ([^,]+)/);
          const branch = branchMatch?.[1]?.trim() ?? 'unknown';

          cp.exec(
            `git diff-tree --no-commit-id -r --name-only ${hash}`,
            { cwd: root },
            (err2, filesOut) => {
              resolve({
                hash: commitHash?.trim() ?? hash,
                message: message?.trim() ?? '',
                timestamp: timestamp?.trim() ?? new Date().toISOString(),
                branch,
                filesChanged: filesOut.trim().split('\n').filter(Boolean)
              });
            }
          );
        }
      );
    });
  }

  private countCommits(root: string, from: string | null, to: string): Promise<number> {
    return new Promise(resolve => {
      const range = from ? `${from}..${to}` : to;
      cp.exec(`git rev-list --count ${range}`, { cwd: root }, (err, out) => {
        resolve(err ? 1 : parseInt(out.trim(), 10) || 1);
      });
    });
  }

  // Called by LocalServer when a post-commit hook fires
  handleHookCommit(root: string, hash: string, message: string, timestamp: string): void {
    if (this.recentCommits.has(hash)) return;
    this.recentCommits.add(hash);
    setTimeout(() => this.recentCommits.delete(hash), 5000);

    cp.exec(
      `git diff-tree --no-commit-id -r --name-only ${hash}`,
      { cwd: root },
      (_, filesOut) => {
        this.onCommit(root, {
          hash,
          message,
          timestamp,
          branch: 'unknown',
          filesChanged: filesOut.trim().split('\n').filter(Boolean)
        });
      }
    );
  }

  // Called by LocalServer when a post-push hook fires
  async handleHookPush(root: string, remote: string, branch: string): Promise<void> {
    const pushKey = `${root}:hook`;
    if (this.recentPushes.has(pushKey)) return;
    this.recentPushes.add(pushKey);
    setTimeout(() => this.recentPushes.delete(pushKey), 5000);

    await this.onPush(root, {
      timestamp: new Date().toISOString(),
      remote,
      branch,
      commitCount: 1
    });
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
