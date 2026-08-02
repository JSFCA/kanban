import { execFileSync } from "node:child_process";

/**
 * Brings the container up before the suite runs.
 *
 * This deliberately does NOT use Playwright's `webServer`. That option expects a
 * long-lived foreground process, and reports "Process from config.webServer
 * exited early" if the command returns before its own URL poll happens to land.
 * start.sh launches a detached container and exits as soon as /api/health
 * answers, so under `webServer` it failed intermittently even on a completely
 * healthy start.
 *
 * start.sh is idempotent -- it rebuilds, replaces any running container, and
 * waits for health itself -- so running it here is safe every time.
 */
export default function globalSetup() {
  const script =
    process.platform === "win32" ? "..\\scripts\\start.ps1" : "../scripts/start.sh";
  const command = process.platform === "win32" ? "powershell" : script;
  const args = process.platform === "win32" ? ["-File", script] : [];

  execFileSync(command, args, { stdio: "inherit" });
}
