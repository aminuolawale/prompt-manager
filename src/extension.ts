import * as vscode from 'vscode';
import { FileManager } from './session/FileManager';
import { SessionManager } from './session/SessionManager';
import { WatcherRegistry } from './watchers/WatcherRegistry';
import { GitWatcher } from './git/GitWatcher';
import { HookInstaller } from './git/HookInstaller';
import { LocalServer } from './server/LocalServer';
import { SyncService } from './sync/SyncService';
import { StatusBar } from './ui/StatusBar';
import { SidebarProvider } from './ui/SidebarProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const fileManager = new FileManager();
  const syncService = new SyncService();
  const sessionManager = new SessionManager(fileManager, syncService);
  const watcherRegistry = new WatcherRegistry();
  const hookInstaller = new HookInstaller();
  const statusBar = new StatusBar();
  const sidebar = new SidebarProvider(context.extensionUri);
  const server = new LocalServer();

  // Bind workspace → workspaceId for routing hook callbacks
  const workspaceIdToRoot = new Map<string, string>();

  const registerWorkspace = (root: string, port: number) => {
    const id = HookInstaller.workspaceId(root);
    workspaceIdToRoot.set(id, root);

    if (vscode.workspace.getConfiguration('promptTracker').get<boolean>('autoInjectGitHooks', true)) {
      hookInstaller.install(root, port);
    }
  };

  // Start the local server first so we have a port for hook scripts
  const port = await server.start();

  // Route hook callbacks through GitWatcher
  const gitWatcher = new GitWatcher(
    (root, commit) => sessionManager.recordCommit(root, commit),
    async (root, push) => {
      statusBar.showSyncing();
      await sessionManager.closeSession(root, push);
    }
  );

  server.onCommit(({ workspaceId, hash, message, timestamp }) => {
    const root = workspaceIdToRoot.get(workspaceId);
    if (root) gitWatcher.handleHookCommit(root, hash, message, timestamp);
  });

  server.onPush(async ({ workspaceId, remote, branch }) => {
    const root = workspaceIdToRoot.get(workspaceId);
    if (root) await gitWatcher.handleHookPush(root, remote, branch);
  });

  // Mirror session changes to UI
  context.subscriptions.push(
    sessionManager.onSessionChanged(root => {
      const activeRoot = activeWorkspaceRoot();
      if (root === activeRoot) {
        const session = sessionManager.get(root) ?? null;
        statusBar.update(session);
        sidebar.update(session);
      }
    })
  );

  // Register sidebar webview
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar)
  );

  // Initialize agent watchers (async, non-blocking)
  watcherRegistry.initialize().then(() => {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      watcherRegistry.startAll(folder.uri.fsPath, (_agentId, turn) => {
        sessionManager.appendTurn(folder.uri.fsPath, turn);
      });
    }
  });

  // Activate each workspace folder
  const activateFolder = async (folder: vscode.WorkspaceFolder) => {
    const root = folder.uri.fsPath;
    registerWorkspace(root, port);
    await sessionManager.retryFailed(root);

    // Refresh UI for the initial active folder
    if (folder === vscode.workspace.workspaceFolders?.[0]) {
      statusBar.update(sessionManager.get(root) ?? null);
      sidebar.update(sessionManager.get(root) ?? null);
    }
  };

  await gitWatcher.initialize();

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    await activateFolder(folder);
  }

  // Handle workspace folder changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async e => {
      for (const added of e.added) {
        await activateFolder(added);
        watcherRegistry.startAll(added.uri.fsPath, (_agentId, turn) => {
          sessionManager.appendTurn(added.uri.fsPath, turn);
        });
      }
      for (const removed of e.removed) {
        const root = removed.uri.fsPath;
        watcherRegistry.stopAll(root);
        hookInstaller.uninstall(root);
        workspaceIdToRoot.delete(HookInstaller.workspaceId(root));
      }
    })
  );

  // Update UI when active editor changes workspace folder
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (!editor) return;
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (!folder) return;
      const root = folder.uri.fsPath;
      statusBar.update(sessionManager.get(root) ?? null);
      sidebar.update(sessionManager.get(root) ?? null);
    })
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('promptTracker.endSession', async () => {
      const root = activeWorkspaceRoot();
      if (!root) return;

      const answer = await vscode.window.showQuickPick(['Yes, end session', 'Cancel'], {
        placeHolder: 'End and sync the current session now?'
      });
      if (answer !== 'Yes, end session') return;

      statusBar.showSyncing();
      await sessionManager.closeSession(root, {
        timestamp: new Date().toISOString(),
        remote: 'manual',
        branch: 'unknown',
        commitCount: 0
      });
    }),

    vscode.commands.registerCommand('promptTracker.openSidebar', () => {
      vscode.commands.executeCommand('promptSessions.sidebar.focus');
    }),

    vscode.commands.registerCommand('promptTracker.showStatus', () => {
      const root = activeWorkspaceRoot();
      const session = root ? sessionManager.get(root) : undefined;
      if (!session) {
        vscode.window.showInformationMessage('Prompt Tracker: no active session.');
        return;
      }
      const agentSummary = session.agents
        .map(a => `${a.name} (↑${a.totalTokensIn.toLocaleString()} ↓${a.totalTokensOut.toLocaleString()})`)
        .join(', ') || 'no agent turns yet';
      vscode.window.showInformationMessage(
        `Prompt Tracker: ${session.conversation.length} turns · ${session.commits.length} commits · ${agentSummary}`
      );
    })
  );

  // Cleanup on deactivation
  context.subscriptions.push(
    { dispose: () => server.stop() },
    { dispose: () => sessionManager.dispose() },
    { dispose: () => watcherRegistry.dispose() },
    { dispose: () => gitWatcher.dispose() },
    { dispose: () => hookInstaller.uninstallAll() },
    { dispose: () => statusBar.dispose() }
  );
}

function activeWorkspaceRoot(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder) return folder.uri.fsPath;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function deactivate(): void {
  // subscriptions handle cleanup
}
