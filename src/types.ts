import type * as vscode from 'vscode';

export interface ConversationTurn {
  seq: number;
  role: 'user' | 'agent';
  agentName?: string;
  content: string;
  timestamp: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheTokens?: number;
  estimated?: boolean;
}

export type AgentProvider =
  | 'claude-code'
  | 'gemini-cli'
  | 'codex-cli'
  | 'copilot'
  | 'continue'
  | 'aider'
  | 'unknown';

export interface AgentSummary {
  name: string;
  provider: AgentProvider;
  totalTokensIn: number;
  totalTokensOut: number;
  cacheTokens: number;
}

export interface CommitInfo {
  hash: string;
  message: string;
  timestamp: string;
  branch: string;
  filesChanged: string[];
}

export interface PushInfo {
  timestamp: string;
  remote: string;
  branch: string;
  commitCount: number;
}

export type SessionStatus = 'active' | 'syncing' | 'done';

export interface Session {
  id: string;
  workspaceRoot: string;
  startedAt: string;
  agents: AgentSummary[];
  conversation: ConversationTurn[];
  commits: CommitInfo[];
  push: PushInfo | null;
  status: SessionStatus;
}
