import * as vscode from 'vscode';
import { Session } from '../types';

export class StatusBar {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'promptTracker.openSidebar';
    this.item.show();
    this.update(null);
  }

  update(session: Session | null): void {
    if (!session || session.status !== 'active') {
      this.item.text = '$(circle-outline) No session';
      this.item.tooltip = 'Prompt Tracker — click to open panel';
      this.item.color = undefined;
      return;
    }

    const turns = session.conversation.length;
    const commits = session.commits.length;
    const duration = this.duration(session.startedAt);
    const agents = session.agents.map(a => a.name).join(', ') || 'no agent yet';

    this.item.text = `$(clock) ${duration}  $(comment-discussion) ${turns}  $(git-commit) ${commits}`;
    this.item.tooltip = `Prompt Session — ${agents}\nClick to open panel`;
    this.item.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
  }

  showSyncing(): void {
    this.item.text = '$(sync~spin) Syncing…';
    this.item.color = undefined;
  }

  private duration(startedAt: string): string {
    const min = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000);
    return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
