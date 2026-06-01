const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const baseDir = process.pkg ? path.dirname(process.execPath) : path.resolve(__dirname, "..");
const port = process.env.PORT || "8443";
const serverExe = path.join(baseDir, "LTE-Intercom-Server.exe");
const trayScript = path.join(baseDir, "tray", "LTE-Intercom-Tray.ps1");
const adminExe = path.join(baseDir, "LTE-Intercom-Admin.exe");
const logDir = path.join(baseDir, "logs");
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(logDir, { recursive: true });
  if (!(await isServerOnline())) {
    spawn(serverExe, [], {
      cwd: baseDir,
      detached: true,
      stdio: "ignore",
      env: process.env
    }).unref();
    await waitForServer();
  }

  startTray();

  spawn(adminExe, [], {
    cwd: baseDir,
    detached: true,
    stdio: "ignore",
    env: process.env
  }).unref();
}

function startTray() {
  fs.appendFileSync(path.join(logDir, "tray-launcher.log"), `${new Date().toISOString()} launcher starting tray script ${trayScript}\n`);
  spawn(powershell, [
    "-STA",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    trayScript
  ], {
    cwd: baseDir,
    detached: true,
    stdio: "ignore",
    env: process.env
  }).unref();
}

function isServerOnline() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 800 }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await isServerOnline()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
