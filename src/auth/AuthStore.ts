import * as vscode from 'vscode';
import { UserInfo } from '../types';

const KEY_USER = 'promptTracker.user';
const KEY_REFRESH = 'promptTracker.refreshToken';

/**
 * Thin wrapper around VS Code SecretStorage for persisting the signed-in user.
 * SecretStorage is encrypted by the OS keychain — safe for tokens.
 */
export class AuthStore {
  constructor(private secrets: vscode.SecretStorage) {}

  async getUser(): Promise<UserInfo | null> {
    const raw = await this.secrets.get(KEY_USER);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UserInfo;
    } catch {
      return null;
    }
  }

  async saveUser(user: UserInfo, refreshToken: string): Promise<void> {
    await this.secrets.store(KEY_USER, JSON.stringify(user));
    await this.secrets.store(KEY_REFRESH, refreshToken);
  }

  async getRefreshToken(): Promise<string | null> {
    return (await this.secrets.get(KEY_REFRESH)) ?? null;
  }

  async clear(): Promise<void> {
    await this.secrets.delete(KEY_USER);
    await this.secrets.delete(KEY_REFRESH);
  }
}
