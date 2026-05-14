import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { AgentWatcher, TurnCallback } from './AgentWatcher';
import { ConversationTurn } from '../types';

/**
 * Base for CLI agents that write JSONL conversation logs to a per-workspace directory.
 * Subclasses supply the log root and a line → ConversationTurn parser.
 */
export abstract class CliAgentWatcher implements AgentWatcher {
  abstract readonly agentId: string;

  protected dirWatchers = new Map<string, fs.FSWatcher>();
  protected fileWatchers = new Map<string, fs.FSWatcher>();
  protected filePositions = new Map<string, number>();

  abstract isAvailable(): Promise<boolean>;

  /** Return the directory that holds JSONL files for the given workspace root. */
  protected abstract logDir(workspaceRoot: string): string;

  /** Parse a single JSONL line into a turn (return null to skip). */
  protected abstract parseLine(line: string): Omit<ConversationTurn, 'seq'> | null;

  protected checkBinary(binary: string): Promise<boolean> {
    return new Promise(resolve => {
      cp.exec(`which ${binary}`, err => resolve(!err));
    });
  }

  /**
   * Workspace root → JSONL dir using the convention shared by Claude Code, Gemini CLI,
   * and Codex CLI: replace every '/' in the absolute path with '-'.
   */
  protected defaultLogDir(base: string, workspaceRoot: string): string {
    const slug = workspaceRoot.replace(/\//g, '-');
    return path.join(base, slug);
  }

  start(workspaceRoot: string, onTurn: TurnCallback): void {
    const dir = this.logDir(workspaceRoot);
    this.watchOrDefer(workspaceRoot, dir, onTurn);
  }

  private watchOrDefer(workspaceRoot: string, dir: string, onTurn: TurnCallback): void {
    if (fs.existsSync(dir)) {
      this.watchDir(workspaceRoot, dir, onTurn);
      return;
    }

    // Watch the parent until the target directory appears
    const parent = path.dirname(dir);
    if (!fs.existsSync(parent)) return;

    const pw = fs.watch(parent, (_, filename) => {
      if (filename && path.join(parent, filename) === dir && fs.existsSync(dir)) {
        pw.close();
        this.watchDir(workspaceRoot, dir, onTurn);
      }
    });
  }

  private watchDir(workspaceRoot: string, dir: string, onTurn: TurnCallback): void {
    // Tail the most-recently-modified JSONL file that already exists
    const existing = this.listJsonl(dir).sort(
      (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs
    );
    if (existing.length > 0) this.tailFile(existing[0], onTurn);

    // Watch for new files and changes
    const dw = fs.watch(dir, { recursive: true }, (_, filename) => {
      if (!filename?.endsWith('.jsonl')) return;
      const full = path.join(dir, filename);
      if (!this.fileWatchers.has(full)) this.tailFile(full, onTurn);
    });

    this.dirWatchers.set(workspaceRoot, dw);
  }

  private tailFile(filePath: string, onTurn: TurnCallback): void {
    if (!fs.existsSync(filePath)) return;
    if (this.fileWatchers.has(filePath)) return;

    // Start from current EOF so we only capture new content
    this.filePositions.set(filePath, fs.statSync(filePath).size);

    const fw = fs.watch(filePath, () => {
      const pos = this.filePositions.get(filePath) ?? 0;
      try {
        const stat = fs.statSync(filePath);
        if (stat.size <= pos) return;

        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(stat.size - pos);
        fs.readSync(fd, buf, 0, buf.length, pos);
        fs.closeSync(fd);
        this.filePositions.set(filePath, stat.size);

        for (const line of buf.toString('utf8').split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const turn = this.parseLine(trimmed);
            if (turn) onTurn(turn);
          } catch { /* malformed line */ }
        }
      } catch { /* file may have been rotated */ }
    });

    this.fileWatchers.set(filePath, fw);
  }

  private listJsonl(dir: string): string[] {
    const results: string[] = [];
    const scan = (d: string) => {
      try {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) scan(full);
          else if (entry.name.endsWith('.jsonl')) results.push(full);
        }
      } catch { /* skip unreadable */ }
    };
    scan(dir);
    return results;
  }

  stop(workspaceRoot: string): void {
    this.dirWatchers.get(workspaceRoot)?.close();
    this.dirWatchers.delete(workspaceRoot);
  }

  dispose(): void {
    this.dirWatchers.forEach(w => w.close());
    this.fileWatchers.forEach(w => w.close());
    this.dirWatchers.clear();
    this.fileWatchers.clear();
    this.filePositions.clear();
  }
}
