import * as fs from 'fs';
import * as path from 'path';
import { Session } from '../types';

const SESSION_DIR = '.prompt-sessions';
const ACTIVE_FILE = 'session.active.json';
const FAILED_SUBDIR = 'failed-sync';
const GITIGNORE_ENTRY = '.prompt-sessions/';

export class FileManager {
  private sessionDir(root: string): string {
    return path.join(root, SESSION_DIR);
  }

  private activeFile(root: string): string {
    return path.join(this.sessionDir(root), ACTIVE_FILE);
  }

  private failedDir(root: string): string {
    return path.join(this.sessionDir(root), FAILED_SUBDIR);
  }

  ensureDir(root: string): void {
    fs.mkdirSync(this.failedDir(root), { recursive: true });
    this.ensureGitignore(root);
  }

  private ensureGitignore(root: string): void {
    const gitignorePath = path.join(root, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      if (!content.includes(GITIGNORE_ENTRY)) {
        fs.appendFileSync(gitignorePath, `\n${GITIGNORE_ENTRY}\n`);
      }
    } else {
      fs.writeFileSync(gitignorePath, `${GITIGNORE_ENTRY}\n`);
    }
  }

  read(root: string): Session | null {
    const file = this.activeFile(root);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as Session;
    } catch {
      return null;
    }
  }

  write(root: string, session: Session): void {
    this.ensureDir(root);
    fs.writeFileSync(this.activeFile(root), JSON.stringify(session, null, 2), 'utf8');
  }

  deleteActive(root: string): void {
    const file = this.activeFile(root);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  moveToFailed(root: string, session: Session): void {
    this.ensureDir(root);
    const dest = path.join(this.failedDir(root), `${session.id}.json`);
    fs.writeFileSync(dest, JSON.stringify(session, null, 2), 'utf8');
    this.deleteActive(root);
  }

  readFailed(root: string): Session[] {
    const dir = this.failedDir(root);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .flatMap(f => {
        try {
          return [JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Session];
        } catch {
          return [];
        }
      });
  }

  deleteFailed(root: string, sessionId: string): void {
    const file = path.join(this.failedDir(root), `${sessionId}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
