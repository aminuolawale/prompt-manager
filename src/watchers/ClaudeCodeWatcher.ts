import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { CliAgentWatcher } from './CliAgentWatcher';
import { ConversationTurn } from '../types';

interface ClaudeLine {
  type: 'user' | 'assistant' | 'system';
  message: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  timestamp?: string;
}

export class ClaudeCodeWatcher extends CliAgentWatcher {
  readonly agentId = 'claude-code';

  async isAvailable(): Promise<boolean> {
    return this.checkBinary('claude');
  }

  protected logDir(workspaceRoot: string): string {
    const override = vscode.workspace
      .getConfiguration('promptTracker')
      .get<Record<string, string>>('agentLogDirs', {})['claude-code'];

    const base = override
      ? override.replace('~', os.homedir())
      : path.join(os.homedir(), '.claude', 'projects');

    return this.defaultLogDir(base, workspaceRoot);
  }

  protected parseLine(raw: string): Omit<ConversationTurn, 'seq'> | null {
    const entry = JSON.parse(raw) as ClaudeLine;
    if (entry.type === 'system') return null;

    const content = this.extractContent(entry.message.content);
    if (!content) return null;

    const ts = entry.timestamp ?? new Date().toISOString();

    if (entry.type === 'user') {
      return { role: 'user', content, timestamp: ts };
    }

    return {
      role: 'agent',
      agentName: entry.message.model ?? 'claude-sonnet-4-6',
      content,
      timestamp: ts,
      tokensIn: entry.message.usage?.input_tokens ?? 0,
      tokensOut: entry.message.usage?.output_tokens ?? 0,
      cacheTokens:
        (entry.message.usage?.cache_read_input_tokens ?? 0) +
        (entry.message.usage?.cache_creation_input_tokens ?? 0)
    };
  }

  private extractContent(c: string | Array<{ type: string; text?: string }>): string {
    if (typeof c === 'string') return c;
    return c
      .filter(p => p.type === 'text' && p.text)
      .map(p => p.text!)
      .join('');
  }
}
