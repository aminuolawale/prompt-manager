# Prompt Session Tracker

I built this VS Code extension because I kept wondering: *how much of this code did I actually write, and how much did an AI agent write?* More specifically, I wanted a clear record of every session — from the first prompt I sent to a coding agent, through every commit I made, to the final push. Not just for curiosity, but to understand my own AI-assisted workflow over time.

Prompt Session Tracker watches your AI agents in the background, records the full conversation and token usage, captures every git commit in the session, and syncs the whole thing to a Neon PostgreSQL database when you push. All you do is code.

---

## What it tracks

Every session covers the period between the first agent prompt detected in a workspace and the git push that closes it. The session record includes:

- **Start time and duration** — when the session began and how long it ran
- **Full conversation** — every user prompt and agent response, in order, with timestamps
- **Agent identities** — which model versions responded (`claude-sonnet-4-6`, `gemini-2.0-flash`, etc.)
- **Token usage** — input tokens, output tokens, and cache tokens, broken down per agent
- **Every commit** made during the session — hash, message, branch, and files changed
- **The push** that closed the session — remote, branch, timestamp, and commit count

---

## Supported agents

I built watchers for the agents I personally use most:

| Agent | How it's captured |
|---|---|
| **Claude Code** | File-watches `~/.claude/projects/<workspace>/` JSONL logs |
| **Gemini CLI** | File-watches `~/.gemini/sessions/<workspace>/` JSONL logs |
| **OpenAI Codex CLI** | File-watches `~/.codex/sessions/<workspace>/` JSONL logs |
| **GitHub Copilot** | VS Code Chat participant API via `@prompt-tracker` |

Agents that aren't installed are silently skipped. Multiple agents can be active within the same session — I often have Claude Code open in the terminal while also using Copilot in the editor.

---

## How a session works

```
Open a git workspace
        │
        ▼
First prompt detected → session starts, state written to .prompt-sessions/
        │
   Each prompt/response is appended as it happens
   Each git commit is recorded (hash, message, files)
        │
   git push to remote
        │
        ▼
Session finalized → synced to Neon → local state file deleted
```

The session is persisted locally to `.prompt-sessions/session.active.json` while it's in progress. This means if VS Code crashes or my laptop dies mid-session, nothing is lost — the state is on disk and the next workspace open picks it up. If a sync to Neon fails, the session moves to `.prompt-sessions/failed-sync/` and is retried automatically the next time I open that workspace.

Both paths are added to `.gitignore` automatically, so session data never ends up committed to the repo.

---

## Setup

### 1. Install the extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=prompt-tracker.prompt-session-tracker), or build from source:

```bash
npm install
npm run package
code --install-extension prompt-session-tracker-0.1.0.vsix
```

### 2. Create a Google OAuth Client ID

I use Google sign-in to tie sessions to my identity in the database. No server is involved — the extension handles the full PKCE OAuth flow locally. You only need to create a Client ID once.

1. Go to [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth 2.0 Client ID**
3. Application type: **Desktop app**
4. Name it anything (e.g. "Prompt Session Tracker")
5. Click **Create** and copy the **Client ID** — you don't need the client secret

Add it to your VS Code settings:

```jsonc
{
  "promptTracker.googleClientId": "123456789-abc.apps.googleusercontent.com"
}
```

### 3. Create a Neon database

I use [Neon](https://neon.tech) because it's serverless and the free tier is enough for personal session data. Sign up, create a project, and copy the connection string from the dashboard:

```
postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require
```

Add it to settings:

```jsonc
{
  "promptTracker.connectionString": "postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require"
}
```

The `prompt_sessions` table is created automatically on first sync — no migrations to run.

### 4. Sign in

Open the **Prompt Sessions** panel in the Explorer sidebar and click **Sign in with Google**. Your browser opens, you approve access, the tab closes, and your profile appears in the panel. From this point on, every session is stamped with your account.

---

## Database schema

```sql
CREATE TABLE prompt_sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  user_email      TEXT,
  workspace       TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  pushed_at       TIMESTAMPTZ,
  agents          JSONB,            -- [{ name, provider, totalTokensIn, totalTokensOut, cacheTokens }]
  token_total_in  INT NOT NULL DEFAULT 0,
  token_total_out INT NOT NULL DEFAULT 0,
  cache_tokens    INT NOT NULL DEFAULT 0,
  message_count   INT NOT NULL DEFAULT 0,
  commit_count    INT NOT NULL DEFAULT 0,
  commits         JSONB,            -- [{ hash, message, timestamp, branch, filesChanged }]
  conversation    JSONB,            -- [{ seq, role, agentName, content, timestamp, tokensIn, tokensOut }]
  push_remote     TEXT,
  push_branch     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Once data is in Neon I can query it however I like. Some queries I find useful:

```sql
-- Token spend per day
SELECT date_trunc('day', started_at) AS day,
       sum(token_total_in + token_total_out) AS total_tokens
FROM prompt_sessions
GROUP BY 1 ORDER BY 1 DESC;

-- Sessions where I used Claude Code
SELECT id, workspace, started_at, message_count, commit_count
FROM prompt_sessions
WHERE agents @> '[{"provider": "claude-code"}]'
ORDER BY started_at DESC;

-- Average session length
SELECT avg(extract(epoch FROM (pushed_at - started_at)) / 60)::int AS avg_minutes
FROM prompt_sessions
WHERE pushed_at IS NOT NULL;
```

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `promptTracker.googleClientId` | `""` | Google OAuth 2.0 Client ID (Desktop app type) |
| `promptTracker.connectionString` | `""` | Neon PostgreSQL connection string |
| `promptTracker.syncOnPush` | `true` | Sync to Neon on git push; set to `false` to keep sessions local only |
| `promptTracker.autoInjectGitHooks` | `true` | Install `post-commit`/`post-push` hooks for reliable event detection |
| `promptTracker.agents` | all | Which agents to watch: `claude-code`, `gemini-cli`, `codex-cli`, `copilot` |
| `promptTracker.agentLogDirs` | `{}` | Override log directories if you installed agents to non-default paths |

### Overriding log directories

If you installed an agent to a non-standard location, point the watcher at the right directory:

```jsonc
{
  "promptTracker.agentLogDirs": {
    "claude-code": "~/work/.claude/projects",
    "gemini-cli": "/opt/gemini/sessions"
  }
}
```

---

## Commands

Open the Command Palette (`⇧⌘P`) and search **Prompt Tracker**:

| Command | Description |
|---|---|
| `Prompt Tracker: Sign In with Google` | Authenticate and link sessions to your Google account |
| `Prompt Tracker: Sign Out` | Remove stored credentials from VS Code's secret store |
| `Prompt Tracker: Open Session Panel` | Open the sidebar with live session stats |
| `Prompt Tracker: Show Session Status` | Quick status notification with turn/commit counts |
| `Prompt Tracker: End Session Manually` | Close and sync the current session without waiting for a push |

---

## UI

**Status bar** (bottom of the window) shows the current session at a glance:

```
⏱ 42m  💬 17  ⎇ 2
```

That's duration, conversation turns, and commits. Clicking it opens the sidebar.

**Sidebar panel** (Explorer → Prompt Sessions) gives a fuller picture:

- Session stats: duration, start time, token counts, commit count
- Agent pills showing every model that responded in this session
- Last 20 conversation turns with role labels and truncated content
- Commit list with short SHA and message
- A manual "End Session" button for when I want to close a session before pushing

---

## Git hooks

When `autoInjectGitHooks` is enabled (the default), the extension appends small blocks to `.git/hooks/post-commit` and `.git/hooks/post-push`. These fire a background `curl` to a local HTTP server that only listens on `127.0.0.1` so commit and push events are captured instantly, even when VS Code's own Git extension is slow to poll.

The hook blocks are wrapped in markers so they can be removed cleanly:

```sh
# prompt-session-tracker:start
HASH=$(git log -1 --format="%H")
MSG=$(git log -1 --format="%s")
curl -sf "http://127.0.0.1:<port>/git/commit?ws=<id>" \
  -X POST --max-time 2 \
  -d "hash=$HASH&message=$MSG" >/dev/null 2>&1 &
# prompt-session-tracker:end
```

If a hook file already exists, the block is appended — it never overwrites your existing hook. On deactivation or workspace close, the block is removed, and if the file becomes empty it's deleted entirely.

If you prefer not to use hooks, disable `autoInjectGitHooks` — the extension falls back to VS Code's git state change events.

---

## Multi-workspace support

I track one session per workspace folder. In a multi-root workspace, the session shown in the sidebar and status bar is the one containing the file currently open in the editor. All folders are tracked independently in the background.

---

## Building from source

```bash
npm install
npm run build        # development build with source maps
npm run build:prod   # minified production build
npm run lint         # TypeScript type-check only
npm run package      # build:prod + pack into .vsix
```

---

## Publishing to the Marketplace

**One-time setup:**

1. Create a publisher at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
2. Set `"publisher"` in `package.json` to your publisher ID
3. Add a 128×128 PNG icon at `resources/icon.png`
4. Get a Personal Access Token from [dev.azure.com](https://dev.azure.com) with **Marketplace → Manage** scope
5. Add the token as a GitHub Actions secret named `VSCE_PAT`

**To publish manually:**

```bash
npx vsce login <your-publisher-id>
npm run package
npx vsce publish
```

**To publish via CI** — push a version tag and the workflow handles it:

```bash
git tag v0.1.1
git push origin v0.1.1
```

The `.github/workflows/publish.yml` workflow runs on every `v*` tag and publishes automatically using the `VSCE_PAT` secret.

---

## License

MIT
