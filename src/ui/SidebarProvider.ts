import * as vscode from 'vscode';
import { Session } from '../types';

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'promptSessions.sidebar';

  private view?: vscode.WebviewView;
  private latestSession: Session | null = null;

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
      if (msg.command === 'endSession') {
        vscode.commands.executeCommand('promptTracker.endSession');
      }
    });
    if (this.latestSession) this.push(this.latestSession);
  }

  update(session: Session | null): void {
    this.latestSession = session;
    if (this.view?.visible) this.push(session);
  }

  private push(session: Session | null): void {
    this.view?.webview.postMessage({ command: 'update', session });
  }

  private buildHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
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
  #empty { opacity: .5; font-style: italic; text-align: center; padding: 30px 10px; font-size: 12px; }
  #content { display: none; }
</style>
</head>
<body>
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
  let ticker = null;

  window.addEventListener('message', e => {
    if (e.data.command === 'update') { session = e.data.session; render(); }
  });

  function render() {
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

  function endSession() {
    vscode.postMessage({ command: 'endSession' });
  }
</script>
</body>
</html>`;
  }
}
