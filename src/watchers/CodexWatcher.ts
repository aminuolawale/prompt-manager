import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { CliAgentWatcher } from './CliAgentWatcher';
import { ConversationTurn } from '../types';

interface CodexLine {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  timestamp?: string;
}

export class CodexWatcher extends CliAgentWatcher {
  readonly agentId = 'codex-cli';

  async isAvailable(): Promise<boolean> {
    return this.checkBinary('codex');
  }

  protected logDir(workspaceRoot: string): string {
    const override = vscode.workspace
      .getConfiguration('promptTracker')
      .get<Record<string, string>>('agentLogDirs', {})['codex-cli'];

    const base = override
      ? override.replace('~', os.homedir())
      : path.join(os.homedir(), '.codex', 'sessions');

    return this.defaultLogDir(base, workspaceRoot);
  }

  protected parseLine(raw: string): Omit<ConversationTurn, 'seq'> | null {
    const entry = JSON.parse(raw) as CodexLine;
    const content =
      typeof entry.content === 'string'
        ? entry.content
        : entry.content
            .filter(c => c.type === 'text' && c.text)
            .map(c => c.text!)
            .join('');

    if (!content) return null;

    const ts = entry.timestamp ?? new Date().toISOString();

    if (entry.role === 'user') {
      return { role: 'user', content, timestamp: ts };
    }

    return {
      role: 'agent',
      agentName: entry.model ?? 'codex-1',
      content,
      timestamp: ts,
      tokensIn: entry.usage?.prompt_tokens ?? 0,
      tokensOut: entry.usage?.completion_tokens ?? 0
    };
  }
}
