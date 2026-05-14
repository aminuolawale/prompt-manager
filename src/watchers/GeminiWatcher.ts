import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { CliAgentWatcher } from './CliAgentWatcher';
import { ConversationTurn } from '../types';

interface GeminiLine {
  role: 'user' | 'model';
  parts: Array<{ text?: string }>;
  modelVersion?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  timestamp?: string;
}

export class GeminiWatcher extends CliAgentWatcher {
  readonly agentId = 'gemini-cli';

  async isAvailable(): Promise<boolean> {
    return this.checkBinary('gemini');
  }

  protected logDir(workspaceRoot: string): string {
    const override = vscode.workspace
      .getConfiguration('promptTracker')
      .get<Record<string, string>>('agentLogDirs', {})['gemini-cli'];

    const base = override
      ? override.replace('~', os.homedir())
      : path.join(os.homedir(), '.gemini', 'sessions');

    return this.defaultLogDir(base, workspaceRoot);
  }

  protected parseLine(raw: string): Omit<ConversationTurn, 'seq'> | null {
    const entry = JSON.parse(raw) as GeminiLine;
    const content = entry.parts
      .filter(p => p.text)
      .map(p => p.text!)
      .join('');

    if (!content) return null;

    const ts = entry.timestamp ?? new Date().toISOString();

    if (entry.role === 'user') {
      return { role: 'user', content, timestamp: ts };
    }

    return {
      role: 'agent',
      agentName: entry.modelVersion ?? 'gemini-2.5-pro',
      content,
      timestamp: ts,
      tokensIn: entry.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: entry.usageMetadata?.candidatesTokenCount ?? 0
    };
  }
}
