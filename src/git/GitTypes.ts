// Minimal type surface for vscode.git extension API (version 1).
// Full definitions live in the vscode.git extension source.

export interface GitExtension {
  getAPI(version: 1): GitAPI;
}

export interface GitAPI {
  repositories: Repository[];
  onDidOpenRepository(listener: (repo: Repository) => void): { dispose(): void };
  onDidCloseRepository(listener: (repo: Repository) => void): { dispose(): void };
}

export interface Repository {
  rootUri: { fsPath: string };
  state: RepositoryState;
}

export interface RepositoryState {
  HEAD: Branch | undefined;
  refs: Ref[];
  remotes: Remote[];
  onDidChange(listener: () => void): { dispose(): void };
}

export interface Branch {
  name?: string;
  commit?: string;
  upstream?: { remote: string; name: string };
}

export interface Ref {
  /** 0=Head, 1=RemoteHead, 2=Tag */
  type: number;
  name?: string;
  commit?: string;
  remote?: string;
}

export interface Remote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}
