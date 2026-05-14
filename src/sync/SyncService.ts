import * as vscode from 'vscode';
import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { Session } from '../types';

export class SyncService {
  private sql: NeonQueryFunction<false, false> | null = null;
  private tableReady = false;

  private connect(): NeonQueryFunction<false, false> {
    const cs = vscode.workspace
      .getConfiguration('promptTracker')
      .get<string>('connectionString', '');

    if (!cs) throw new Error('promptTracker.connectionString is not configured');

    // Re-use the client unless the connection string changed
    if (!this.sql) this.sql = neon(cs);
    return this.sql;
  }

  private async ensureTable(sql: NeonQueryFunction<false, false>): Promise<void> {
    if (this.tableReady) return;
    await sql`
      CREATE TABLE IF NOT EXISTS prompt_sessions (
        id              TEXT PRIMARY KEY,
        workspace       TEXT NOT NULL,
        started_at      TIMESTAMPTZ NOT NULL,
        pushed_at       TIMESTAMPTZ,
        agents          JSONB,
        token_total_in  INT NOT NULL DEFAULT 0,
        token_total_out INT NOT NULL DEFAULT 0,
        cache_tokens    INT NOT NULL DEFAULT 0,
        message_count   INT NOT NULL DEFAULT 0,
        commit_count    INT NOT NULL DEFAULT 0,
        commits         JSONB,
        conversation    JSONB,
        push_remote     TEXT,
        push_branch     TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    this.tableReady = true;
  }

  async upload(session: Session): Promise<void> {
    const sql = this.connect();
    await this.ensureTable(sql);

    const totalIn    = session.agents.reduce((s, a) => s + a.totalTokensIn, 0);
    const totalOut   = session.agents.reduce((s, a) => s + a.totalTokensOut, 0);
    const cacheTotal = session.agents.reduce((s, a) => s + a.cacheTokens, 0);

    await sql`
      INSERT INTO prompt_sessions (
        id, workspace, started_at, pushed_at,
        agents, token_total_in, token_total_out, cache_tokens,
        message_count, commit_count,
        commits, conversation,
        push_remote, push_branch
      ) VALUES (
        ${session.id},
        ${session.workspaceRoot},
        ${session.startedAt},
        ${session.push?.timestamp ?? null},
        ${JSON.stringify(session.agents)},
        ${totalIn},
        ${totalOut},
        ${cacheTotal},
        ${session.conversation.length},
        ${session.commits.length},
        ${JSON.stringify(session.commits)},
        ${JSON.stringify(session.conversation)},
        ${session.push?.remote ?? null},
        ${session.push?.branch ?? null}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
}
