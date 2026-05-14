import * as vscode from 'vscode';
import { AgentWatcher, TurnCallback } from './AgentWatcher';
import { ClaudeCodeWatcher } from './ClaudeCodeWatcher';
import { GeminiWatcher } from './GeminiWatcher';
import { CodexWatcher } from './CodexWatcher';
import { CopilotWatcher } from './CopilotWatcher';

export class WatcherRegistry {
  private readonly all: AgentWatcher[] = [
    new ClaudeCodeWatcher(),
    new GeminiWatcher(),
    new CodexWatcher(),
    new CopilotWatcher()
  ];

  private active: AgentWatcher[] = [];

  async initialize(): Promise<void> {
    const enabled = vscode.workspace
      .getConfiguration('promptTracker')
      .get<string[]>('agents', ['claude-code', 'gemini-cli', 'codex-cli', 'copilot']);

    const checks = await Promise.all(
      this.all
        .filter(w => enabled.includes(w.agentId))
        .map(async w => ({ watcher: w, ok: await w.isAvailable() }))
    );

    this.active = checks.filter(c => c.ok).map(c => c.watcher);

    if (this.active.length > 0) {
      const names = this.active.map(w => w.agentId).join(', ');
      vscode.window.setStatusBarMessage(`Prompt Tracker: watching ${names}`, 4000);
    }
  }

  startAll(workspaceRoot: string, onTurn: (agentId: string, turn: Parameters<TurnCallback>[0]) => void): void {
    for (const w of this.active) {
      w.start(workspaceRoot, turn => onTurn(w.agentId, turn));
    }
  }

  stopAll(workspaceRoot: string): void {
    for (const w of this.active) w.stop(workspaceRoot);
  }

  activeAgentIds(): string[] {
    return this.active.map(w => w.agentId);
  }

  dispose(): void {
    for (const w of this.all) w.dispose();
  }
}
