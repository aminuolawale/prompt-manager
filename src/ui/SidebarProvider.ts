import * as vscode from 'vscode';
import { Session, UserInfo } from '../types';

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'promptSessions.sidebar';

  private view?: vscode.WebviewView;
  private latestSession: Session | null = null;
  private latestUser: UserInfo | null = null;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    view: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    view.webview.html = this.buildHtml();
    view.webview.onDidReceiveMessage(msg => {
      switch (msg.command) {
        case 'endSession': vscode.commands.executeCommand('promptTracker.endSession'); break;
        case 'signIn':    vscode.commands.executeCommand('promptTracker.signIn'); break;
        case 'signOut':   vscode.commands.executeCommand('promptTracker.signOut'); break;
      }
    });
    this.pushAll();
  }

  update(session: Session | null): void {
    this.latestSession = session;
    if (this.view?.visible) this.pushAll();
  }

  updateUser(user: UserInfo | null): void {
    this.latestUser = user;
    if (this.view?.visible) this.pushAll();
  }

  private pushAll(): void {
    this.view?.webview.postMessage({ command: 'update', session: this.latestSession, user: this.latestUser });
  }

  private buildHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https:;">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: transparent;
    padding: 8px;
    margin: 0;
  }
  h3 {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .05em;
    opacity: .55;
    margin: 12px 0 4px;
  }
  .card {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-widget-border, #444);
    border-radius: 4px;
    padding: 8px 10px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    padding: 2px 0;
    font-size: 12px;
  }
  .row .label { opacity: .65; }
  .row .value { font-weight: 600; font-variant-numeric: tabular-nums; }
  .turns { max-height: 220px; overflow-y: auto; }
  .turn { padding: 5px 0; border-bottom: 1px solid var(--vscode-widget-border, #333); }
  .turn:last-child { border-bottom: none; }
  .turn .role {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .08em;
    opacity: .55;
    margin-bottom: 2px;
  }
  .turn.user .role { color: var(--vscode-terminal-ansiBlue, #5b9bd5); }
  .turn.agent .role { color: var(--vscode-terminal-ansiGreen, #6bc46d); }
  .turn .body { font-size: 11px; white-space: pre-wrap; word-break: break-word; }
  .commit { font-size: 11px; padding: 3px 0; }
  .commit .sha { opacity: .4; margin-right: 5px; font-family: monospace; }
  .agent-pill {
    display: inline-block;
    font-size: 10px;
    background: var(--vscode-badge-background, #444);
    color: var(--vscode-badge-foreground, #fff);
    border-radius: 10px;
    padding: 1px 7px;
    margin: 2px 2px 0 0;
  }
  button {
    width: 100%;
    margin-top: 10px;
    padding: 6px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground, #3c3c3c);
    color: var(--vscode-button-secondaryForeground, #ccc);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, #4a4a4a); }
  #empty { opacity: .5; font-style: italic; text-align: center; padding: 30px 10px; font-size: 12px; }
  #content { display: none; }
  .user-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
  }
  .user-avatar {
    width: 32px; height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .user-avatar-placeholder {
    width: 32px; height: 32px;
    border-radius: 50%;
    background: var(--vscode-badge-background, #444);
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 700; flex-shrink: 0;
    color: var(--vscode-badge-foreground, #fff);
  }
  .user-info { flex: 1; min-width: 0; }
  .user-name { font-weight: 600; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .user-email { font-size: 10px; opacity: .6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sign-out-btn { font-size: 10px; padding: 3px 8px; margin: 0; width: auto; }
  #auth-section { margin-bottom: 4px; }
</style>
</head>
<body>
<div id="auth-section"></div>
<div id="empty">No active session.<br>Start prompting to begin tracking.</div>
<div id="content">
  <h3>Active Session</h3>
  <div class="card">
    <div class="row"><span class="label">Started</span><span class="value" id="startedAt"></span></div>
    <div class="row"><span class="label">Duration</span><span class="value" id="duration"></span></div>
    <div class="row"><span class="label">Turns</span><span class="value" id="turns"></span></div>
    <div class="row"><span class="label">Tokens in</span><span class="value" id="tokensIn"></span></div>
    <div class="row"><span class="label">Tokens out</span><span class="value" id="tokensOut"></span></div>
    <div class="row"><span class="label">Commits</span><span class="value" id="commitCount"></span></div>
  </div>

  <h3>Agents</h3>
  <div class="card" id="agentPills"></div>

  <h3>Conversation <span id="turnNote" style="font-weight:normal;text-transform:none;font-size:10px;opacity:.4"></span></h3>
  <div class="card turns" id="turns-list"></div>

  <h3>Commits</h3>
  <div class="card" id="commits-list"></div>

  <button onclick="endSession()">End Session Manually</button>
</div>

<script>
  const vscode = acquireVsCodeApi();
  let session = null;
  let user = null;
  let ticker = null;

  window.addEventListener('message', e => {
    if (e.data.command === 'update') {
      session = e.data.session;
      user = e.data.user;
      render();
    }
  });

  function render() {
    renderAuth();
    const hasData = session && session.conversation.length > 0;
    document.getElementById('empty').style.display = hasData ? 'none' : 'block';
    document.getElementById('content').style.display = hasData ? 'block' : 'none';
    if (!hasData) { clearInterval(ticker); return; }

    document.getElementById('startedAt').textContent = fmtDate(session.startedAt);
    document.getElementById('turns').textContent = session.conversation.length;
    document.getElementById('commitCount').textContent = session.commits.length;

    const totalIn  = session.agents.reduce((s, a) => s + a.totalTokensIn, 0);
    const totalOut = session.agents.reduce((s, a) => s + a.totalTokensOut, 0);
    document.getElementById('tokensIn').textContent  = totalIn.toLocaleString();
    document.getElementById('tokensOut').textContent = totalOut.toLocaleString();

    tick();
    clearInterval(ticker);
    ticker = setInterval(tick, 60000);

    // Agents
    const pills = document.getElementById('agentPills');
    if (session.agents.length === 0) {
      pills.innerHTML = '<span style="opacity:.4;font-size:11px">No agent turns yet</span>';
    } else {
      pills.innerHTML = session.agents.map(a =>
        '<span class="agent-pill">' + esc(a.name) + '</span>'
      ).join('');
    }

    // Conversation (last 20 turns)
    const list = document.getElementById('turns-list');
    const turns = session.conversation;
    const shown = turns.slice(-20);
    document.getElementById('turnNote').textContent =
      turns.length > 20 ? '(last 20 of ' + turns.length + ')' : '';
    list.innerHTML = shown.map(t => {
      const label = t.agentName ? t.role + ' · ' + t.agentName : t.role;
      const body = t.content.length > 300 ? t.content.slice(0, 300) + '…' : t.content;
      return '<div class="turn ' + t.role + '">' +
        '<div class="role">' + esc(label) + '</div>' +
        '<div class="body">' + esc(body) + '</div>' +
        '</div>';
    }).join('');
    list.scrollTop = list.scrollHeight;

    // Commits
    const cl = document.getElementById('commits-list');
    if (session.commits.length === 0) {
      cl.innerHTML = '<span style="opacity:.4;font-style:italic;font-size:11px">No commits yet</span>';
    } else {
      cl.innerHTML = session.commits.map(c =>
        '<div class="commit"><span class="sha">' + esc(c.hash.slice(0,7)) + '</span>' + esc(c.message) + '</div>'
      ).join('');
    }
  }

  function tick() {
    if (!session) return;
    const min = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 60000);
    document.getElementById('duration').textContent =
      min < 60 ? min + 'm' : Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderAuth() {
    const el = document.getElementById('auth-section');
    if (user) {
      const initial = (user.name || user.email || '?')[0].toUpperCase();
      const avatar = user.picture
        ? '<img class="user-avatar" src="' + esc(user.picture) + '" alt="">'
        : '<div class="user-avatar-placeholder">' + esc(initial) + '</div>';
      el.innerHTML =
        '<div class="card user-card">' +
        avatar +
        '<div class="user-info"><div class="user-name">' + esc(user.name) + '</div>' +
        '<div class="user-email">' + esc(user.email) + '</div></div>' +
        '<button class="secondary sign-out-btn" onclick="signOut()">Sign out</button>' +
        '</div>';
    } else {
      el.innerHTML =
        '<button onclick="signIn()" style="margin-top:0">Sign in with Google</button>';
    }
  }

  function endSession() { vscode.postMessage({ command: 'endSession' }); }
  function signIn()     { vscode.postMessage({ command: 'signIn' }); }
  function signOut()    { vscode.postMessage({ command: 'signOut' }); }
</script>
</body>
</html>`;
  }
}
