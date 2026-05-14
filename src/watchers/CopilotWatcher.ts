import * as vscode from 'vscode';
import { AgentWatcher, TurnCallback } from './AgentWatcher';

/**
 * Integrates with GitHub Copilot Chat via the VS Code Chat participant API.
 *
 * Because VS Code has no passive observation API for other participants' messages,
 * this registers a @prompt-tracker participant. Users invoke it in Copilot Chat
 * by prefixing their message with "@prompt-tracker", which routes the turn through
 * our handler for capture. A banner explains this on first activation.
 */
export class CopilotWatcher implements AgentWatcher {
  readonly agentId = 'copilot';

  private participant: vscode.ChatParticipant | undefined;
  private callbacks = new Map<string, TurnCallback>();
  private shown = false;

  async isAvailable(): Promise<boolean> {
    return !!(
      vscode.extensions.getExtension('GitHub.copilot-chat') &&
      'chat' in vscode &&
      typeof (vscode as any).chat?.createChatParticipant === 'function'
    );
  }

  start(workspaceRoot: string, onTurn: TurnCallback): void {
    this.callbacks.set(workspaceRoot, onTurn);
    if (this.participant) return;

    try {
      this.participant = (vscode as any).chat.createChatParticipant(
        'prompt-tracker.copilot',
        async (
          request: vscode.ChatRequest,
          _ctx: vscode.ChatContext,
          stream: vscode.ChatResponseStream,
          _token: vscode.CancellationToken
        ) => {
          const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!folder) return;

          const cb = this.callbacks.get(folder);
          if (cb) {
            cb({
              role: 'user',
              content: request.prompt,
              timestamp: new Date().toISOString()
            });
          }

          stream.markdown('*(turn captured by Prompt Session Tracker)*');
        }
      );

      if (this.participant) {
        this.participant.iconPath = new vscode.ThemeIcon('record');
      }

      if (!this.shown) {
        this.shown = true;
        vscode.window.showInformationMessage(
          'Prompt Tracker: use @prompt-tracker in Copilot Chat to capture those turns in your session.'
        );
      }
    } catch {
      // vscode.chat not available in this build
    }
  }

  stop(workspaceRoot: string): void {
    this.callbacks.delete(workspaceRoot);
    if (this.callbacks.size === 0) {
      this.participant?.dispose();
      this.participant = undefined;
    }
  }

  dispose(): void {
    this.participant?.dispose();
    this.participant = undefined;
    this.callbacks.clear();
  }
}
