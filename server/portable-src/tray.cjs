const { spawn } = require("node:child_process");
const path = require("node:path");

const baseDir = process.pkg ? path.dirname(process.execPath) : path.resolve(__dirname, "..");
const scriptPath = path.join(baseDir, "tray", "LTE-Intercom-Tray.ps1");
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

const child = spawn(powershell, [
  "-STA",
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  scriptPath
], {
  cwd: baseDir,
  detached: false,
  stdio: "ignore",
  env: process.env
});

child.on("exit", (code) => {
  process.exitCode = code || 0;
});
