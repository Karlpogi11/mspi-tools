import { execFileSync } from 'node:child_process';
import path from 'node:path';

if (process.platform === 'win32') {
  const workspace = path.resolve(process.cwd()).replaceAll("'", "''");
  const script = `
    $workspace = '${workspace}'
    $ports = @(3001, 5173)
    foreach ($port in $ports) {
      $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
      foreach ($listener in $listeners) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
        if ($process -and $process.CommandLine -and $process.CommandLine.Contains($workspace)) {
          Write-Host "Stopping stale MSPI dev process on port $port (PID $($process.ProcessId))..."
          Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        }
      }
    }
    exit 0
  `;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit' });
}
