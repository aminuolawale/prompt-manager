# Prompt Session Tracker

A VS Code extension that records your AI-assisted coding sessions — from the first prompt to the git push — and syncs them to a Neon PostgreSQL database.

## What it tracks

Each session covers the period between opening a workspace and pushing a commit to a remote. The session record contains:

- Start time and duration
- Full conversation (user prompts and agent responses)
- Agent names and model versions
- Token usage per agent (input, output, cache)
- Every local commit made during the session (hash, message, files changed)
- The push that closes the session (remote, branch, timestamp)

## Supported agents

| Agent | How it's captured |
|---|---|
| Claude Code | File-watches `~/.claude/projects/<workspace>/` JSONL logs |
| Gemini CLI | File-watches `~/.gemini/sessions/<workspace>/` JSONL logs |
| Codex CLI | File-watches `~/.codex/sessions/<workspace>/` JSONL logs |
| GitHub Copilot | VS Code Chat participant API — invoke with `@prompt-tracker` in Copilot Chat |

Agents that aren't installed are silently skipped. Multiple agents can be active in the same session.

## Setup

### 1. Install the extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=prompt-tracker.prompt-session-tracker), or build from source:

```bash
npm run package
code --install-extension prompt-session-tracker-0.1.0.vsix
```

### 2. Create a Google OAuth Client ID

Sessions are tied to your Google account. You need a Client ID to enable sign-in.

1. Go to [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth 2.0 Client ID**
3. Application type: **Desktop app**
4. Name it anything (e.g. "Prompt Session Tracker")
5. Click **Create** and copy the **Client ID** (you don't need the client secret)

Add the Client ID to your VS Code settings:

```jsonc
{
  "promptTracker.googleClientId": "123456789-abc.apps.googleusercontent.com"
}
```

### 3. Create a Neon database

Sign up at [neon.tech](https://neon.tech), create a project, and copy the connection string from the dashboard:

```
postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require
```

Add it to settings:

```jsonc
{
  "promptTracker.connectionString": "postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require"
}
```

The `prompt_sessions` table is created automatically on the first sync.

### 4. Sign in

Open the **Prompt Sessions** panel in the Explorer sidebar and click **Sign in with Google**. Your browser will open, you approve access, and the tab closes. Your profile appears in the panel — you're ready.

## How a session works

```
Open workspace (git repo)
        │
        ▼
First prompt detected → session starts, local file created
        │
   prompts accumulate
   commits accumulate
        │
   git push to remote
        │
        ▼
Session synced to Neon → local file deleted → next session ready
```

Sessions are written to `.prompt-sessions/session.active.json` in your workspace root (automatically added to `.gitignore`). If a sync fails, the session is moved to `.prompt-sessions/failed-sync/` and retried the next time the workspace opens.

## Database schema

```sql
CREATE TABLE prompt_sessions (
  id              TEXT PRIMARY KEY,
  workspace       TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  pushed_at       TIMESTAMPTZ,
  agents          JSONB,           -- array of { name, provider, totalTokensIn, totalTokensOut, cacheTokens }
  token_total_in  INT,
  token_total_out INT,
  cache_tokens    INT,
  message_count   INT,
  commit_count    INT,
  commits         JSONB,           -- array of { hash, message, timestamp, branch, filesChanged }
  conversation    JSONB,           -- array of { seq, role, agentName, content, timestamp, tokensIn, tokensOut }
  push_remote     TEXT,
  push_branch     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `promptTracker.googleClientId` | `""` | Google OAuth 2.0 Client ID (Desktop app type) |
| `promptTracker.connectionString` | `""` | Neon PostgreSQL connection string |
| `promptTracker.syncOnPush` | `true` | Sync to DB on git push; disable to keep sessions local only |
| `promptTracker.autoInjectGitHooks` | `true` | Install `post-commit`/`post-push` git hooks for reliable event detection |
| `promptTracker.agents` | all | Which agents to watch: `claude-code`, `gemini-cli`, `codex-cli`, `copilot` |
| `promptTracker.agentLogDirs` | `{}` | Override log directories if agents are installed to non-default paths |

## Commands

Open the Command Palette (`⇧⌘P`) and search **Prompt Tracker**:

| Command | Description |
|---|---|
| `Prompt Tracker: Sign In with Google` | Authenticate and link sessions to your account |
| `Prompt Tracker: Sign Out` | Remove stored credentials |
| `Prompt Tracker: Open Session Panel` | Open the sidebar with live session stats |
| `Prompt Tracker: Show Session Status` | Quick status notification |
| `Prompt Tracker: End Session Manually` | Close and sync the current session without a push |

## UI

**Status bar** (bottom left) shows the current session at a glance:

```
⏱ 42m  💬 17  ⎇ 2
```
Duration · conversation turns · commits. Click to open the sidebar.

**Sidebar panel** shows:
- Session stats (duration, agents, token counts, commit count)
- Agent pills with model names
- Last 20 conversation turns
- Commit list
- Manual end button

## Git hooks

When `autoInjectGitHooks` is enabled, the extension appends small blocks to `.git/hooks/post-commit` and `.git/hooks/post-push`. These fire a `curl` to a local HTTP server (random port, `127.0.0.1` only) so commit and push events are detected even when VS Code's git state polling is slow. The hooks are removed cleanly when the extension deactivates or the workspace is closed.

If you prefer not to use hooks, disable `autoInjectGitHooks` — the extension falls back to watching the VS Code Git extension's state changes.

## Publishing to the Marketplace

**One-time setup:**

1. Create a publisher account at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
2. Set `"publisher"` in `package.json` to your publisher ID
3. Add a 128×128 PNG icon at `resources/icon.png`
4. Get a Personal Access Token from [dev.azure.com](https://dev.azure.com) with **Marketplace → Manage** scope
5. Add the token as a GitHub Actions secret named `VSCE_PAT`

**To publish:**

```bash
# Manually
npx vsce login <your-publisher-id>
npm run package     # builds the .vsix
npx vsce publish    # uploads to the marketplace
```

```bash
# Via GitHub Actions (automatic on version tags)
git tag v0.1.0
git push origin v0.1.0
```

The `.github/workflows/publish.yml` workflow runs on every `v*` tag push and publishes automatically using the `VSCE_PAT` secret.

## Building from source

```bash
npm install
npm run build        # development build with source maps
npm run build:prod   # minified production build
npm run lint         # type-check only, no output
npm run package      # build + pack .vsix
```

## Multi-workspace support

The extension tracks one session per workspace folder. In a multi-root workspace, the active session is determined by whichever folder contains the file currently open in the editor.
