import * as vscode from 'vscode';

/** Minimal Windows trial: sidebar Webview pointed at /messenger.
 *  Auth reuses the tools.mspi.io cookie session; no secrets stored. */
export function activate(context: vscode.ExtensionContext) {
  const open = vscode.commands.registerCommand('mspi-pulse.open', () => {
    const panel = vscode.window.createWebviewPanel('pulseChat', 'MSPI Pulse', vscode.ViewColumn.One, { enableScripts: true });
    const base = vscode.workspace.getConfiguration('mspi-pulse').get<string>('baseUrl', 'https://tools.mspi.io');
    panel.webview.html = `<!doctype html><html><body style="margin:0;font-family:sans-serif">
      <iframe src="${base}/messenger" style="border:0;width:100%;height:100vh"></iframe></body></html>`;
  });
  const lookup = vscode.commands.registerCommand('mspi-pulse.lookup', async () => {
    const query = await vscode.window.showInputBox({ prompt: 'AR / serial / part (e.g. AR-12345, SN-ABC, 661-1234)' });
    if (!query) return;
    const base = vscode.workspace.getConfiguration('mspi-pulse').get<string>('baseUrl', 'https://tools.mspi.io');
    const panel = vscode.window.createWebviewPanel('pulseLookup', `Pulse: ${query}`, vscode.ViewColumn.Beside, { enableScripts: true });
    panel.webview.html = `<!doctype html><html><body style="margin:0;font-family:sans-serif">
      <iframe src="${base}/messenger" style="border:0;width:100%;height:100vh"></iframe></body></html>`;
  });
  context.subscriptions.push(open, lookup);
}

export function deactivate() {}
