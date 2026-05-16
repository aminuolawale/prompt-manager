import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Session, ConversationTurn, CommitInfo, PushInfo, AgentSummary, AgentProvider, UserInfo } from '../types';
import { FileManager } from './FileManager';
import { SyncService } from '../sync/SyncService';

export class SessionManager {
  private sessions = new Map<string, Session>();
  private currentUser: UserInfo | null = null;

  private _onSessionChanged = new vscode.EventEmitter<string>();
  readonly onSessionChanged = this._onSessionChanged.event;

  constructor(
    private fileManager: FileManager,
    private syncService: SyncService
  ) {}

  setUser(user: UserInfo | null): void {
    this.currentUser = user;
    // Stamp any in-progress sessions with the newly signed-in user
    for (const session of this.sessions.values()) {
      if (!session.userId && user) {
        session.userId = user.id;
        session.userEmail = user.email;
        this.fileManager.write(session.workspaceRoot, session);
        this._onSessionChanged.fire(session.workspaceRoot);
      }
    }
  }

  getOrCreate(root: string): Session {
    if (this.sessions.has(root)) return this.sessions.get(root)!;

    const existing = this.fileManager.read(root);
    if (existing?.status === 'active') {
      this.sessions.set(root, existing);
      return existing;
    }

    const session: Session = {
      id: crypto.randomUUID(),
      workspaceRoot: root,
      startedAt: new Date().toISOString(),
      userId: this.currentUser?.id ?? null,
      userEmail: this.currentUser?.email ?? null,
      agents: [],
      conversation: [],
      commits: [],
      push: null,
      status: 'active'
    };

    this.sessions.set(root, session);
    this.fileManager.write(root, session);
    return session;
  }

  get(root: string): Session | undefined {
    return this.sessions.get(root);
  }

  appendTurn(root: string, turn: Omit<ConversationTurn, 'seq'>): void {
    const session = this.getOrCreate(root);
    const full: ConversationTurn = { ...turn, seq: session.conversation.length + 1 };
    session.conversation.push(full);

    if (turn.role === 'agent' && turn.agentName) {
      this.updateAgentSummary(session, turn.agentName, turn);
    }

    this.fileManager.write(root, session);
    this._onSessionChanged.fire(root);
  }

  private updateAgentSummary(
    session: Session,
    agentName: string,
    turn: Omit<ConversationTurn, 'seq'>
  ): void {
    let agent = session.agents.find(a => a.name === agentName);
    if (!agent) {
      agent = {
        name: agentName,
        provider: this.inferProvider(agentName),
        totalTokensIn: 0,
        totalTokensOut: 0,
        cacheTokens: 0
      };
      session.agents.push(agent);
    }
    agent.totalTokensIn += turn.tokensIn ?? 0;
    agent.totalTokensOut += turn.tokensOut ?? 0;
    agent.cacheTokens += turn.cacheTokens ?? 0;
  }

  private inferProvider(agentName: string): AgentProvider {
    const n = agentName.toLowerCase();
    if (n.startsWith('claude')) return 'claude-code';
    if (n.startsWith('gemini')) return 'gemini-cli';
    if (n.startsWith('codex') || n.startsWith('o1') || n.startsWith('o3') || n.startsWith('gpt')) return 'codex-cli';
    return 'unknown';
  }

  recordCommit(root: string, commit: CommitInfo): void {
    const session = this.getOrCreate(root);
    if (session.commits.find(c => c.hash === commit.hash)) return;
    session.commits.push(commit);
    this.fileManager.write(root, session);
    this._onSessionChanged.fire(root);
  }

  async closeSession(root: string, pushInfo: PushInfo): Promise<void> {
    const session = this.sessions.get(root);
    if (!session) return;

    session.push = pushInfo;
    session.status = 'syncing';
    this.fileManager.write(root, session);
    this._onSessionChanged.fire(root);

    const syncEnabled = vscode.workspace
      .getConfiguration('promptTracker')
      .get<boolean>('syncOnPush', true);

    if (syncEnabled) {
      try {
        await this.syncService.upload(session);
        this.fileManager.deleteActive(root);
      } catch (err) {
        this.fileManager.moveToFailed(root, session);
        vscode.window.showWarningMessage(
          `Prompt Tracker: sync failed — will retry on next activation. (${err})`
        );
      }
    } else {
      this.fileManager.deleteActive(root);
    }

    this.sessions.delete(root);
    this._onSessionChanged.fire(root);

    const duration = this.formatDuration(session.startedAt, pushInfo.timestamp);
    const turnCount = session.conversation.length;
    const commitCount = session.commits.length;
    vscode.window.showInformationMessage(
      `Prompt Tracker: session synced — ${turnCount} turns, ${commitCount} commit(s), ${duration}`
    );
  }

  async retryFailed(root: string): Promise<void> {
    const failed = this.fileManager.readFailed(root);
    for (const session of failed) {
      try {
        await this.syncService.upload(session);
        this.fileManager.deleteFailed(root, session.id);
      } catch {
        // Leave for next retry
      }
    }
  }

  private formatDuration(startedAt: string, endedAt: string): string {
    const min = Math.floor(
      (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000
    );
    return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
  }

  dispose(): void {
    this._onSessionChanged.dispose();
  }
}
