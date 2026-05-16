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
import { AuthStore } from './auth/AuthStore';
import { GoogleAuth } from './auth/GoogleAuth';
import { UserInfo } from './types';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const fileManager = new FileManager();
  const syncService = new SyncService();
  const sessionManager = new SessionManager(fileManager, syncService);
  const watcherRegistry = new WatcherRegistry();
  const hookInstaller = new HookInstaller();
  const statusBar = new StatusBar();
  const sidebar = new SidebarProvider(context.extensionUri);
  const server = new LocalServer();
  const authStore = new AuthStore(context.secrets);

  const port = await server.start();
  const googleAuth = new GoogleAuth(server);

  // ── Auth ────────────────────────────────────────────────────────────────────

  const applyUser = (user: UserInfo | null) => {
    sessionManager.setUser(user);
    sidebar.updateUser(user);
    statusBar.updateUser(user);
  };

  // Restore persisted user on startup
  const storedUser = await authStore.getUser();
  if (storedUser) applyUser(storedUser);

  const signIn = async () => {
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Signing in with Google…', cancellable: false },
        async () => {
          const { user, refreshToken } = await googleAuth.signIn();
          await authStore.saveUser(user, refreshToken);
          applyUser(user);
          vscode.window.showInformationMessage(`Prompt Tracker: signed in as ${user.email}`);
        }
      );
    } catch (err) {
      vscode.window.showErrorMessage(`Prompt Tracker: sign-in failed — ${err}`);
    }
  };

  const signOut = async () => {
    const refreshToken = await authStore.getRefreshToken();
    if (refreshToken) await googleAuth.revokeToken(refreshToken);
    await authStore.clear();
    applyUser(null);
    vscode.window.showInformationMessage('Prompt Tracker: signed out.');
  };

  // ── Git hooks ───────────────────────────────────────────────────────────────

  const workspaceIdToRoot = new Map<string, string>();

  const registerWorkspace = (root: string) => {
    const id = HookInstaller.workspaceId(root);
    workspaceIdToRoot.set(id, root);
    if (vscode.workspace.getConfiguration('promptTracker').get<boolean>('autoInjectGitHooks', true)) {
      hookInstaller.install(root, port);
    }
  };

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

  // ── UI updates ──────────────────────────────────────────────────────────────

  const refreshUI = (root: string) => {
    const session = sessionManager.get(root) ?? null;
    statusBar.update(session);
    sidebar.update(session);
  };

  context.subscriptions.push(
    sessionManager.onSessionChanged(root => {
      if (root === activeWorkspaceRoot()) refreshUI(root);
    })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar)
  );

  // ── Workspace activation ────────────────────────────────────────────────────

  const activateFolder = async (folder: vscode.WorkspaceFolder) => {
    const root = folder.uri.fsPath;
    registerWorkspace(root);
    await sessionManager.retryFailed(root);
    if (folder === vscode.workspace.workspaceFolders?.[0]) refreshUI(root);
  };

  await gitWatcher.initialize();

  watcherRegistry.initialize().then(() => {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      watcherRegistry.startAll(folder.uri.fsPath, (_id, turn) =>
        sessionManager.appendTurn(folder.uri.fsPath, turn)
      );
    }
  });

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    await activateFolder(folder);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async e => {
      for (const added of e.added) {
        await activateFolder(added);
        watcherRegistry.startAll(added.uri.fsPath, (_id, turn) =>
          sessionManager.appendTurn(added.uri.fsPath, turn)
        );
      }
      for (const removed of e.removed) {
        const root = removed.uri.fsPath;
        watcherRegistry.stopAll(root);
        hookInstaller.uninstall(root);
        workspaceIdToRoot.delete(HookInstaller.workspaceId(root));
      }
    }),

    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (!editor) return;
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (folder) refreshUI(folder.uri.fsPath);
    })
  );

  // ── Commands ────────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('promptTracker.signIn', signIn),

    vscode.commands.registerCommand('promptTracker.signOut', signOut),

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
      const agents = session.agents
        .map(a => `${a.name} (↑${a.totalTokensIn.toLocaleString()} ↓${a.totalTokensOut.toLocaleString()})`)
        .join(', ') || 'no agent turns yet';
      vscode.window.showInformationMessage(
        `Prompt Tracker: ${session.conversation.length} turns · ${session.commits.length} commits · ${agents}`
      );
    })
  );

  // ── Cleanup ─────────────────────────────────────────────────────────────────

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

export function deactivate(): void {}
