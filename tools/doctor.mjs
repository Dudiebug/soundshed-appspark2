import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const checks = [];
let hasError = false;
let hasWarn = false;

function run(cmd, args = [], opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: false,
    ...opts
  });

  return {
    code: result.status ?? 1,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? ""
  };
}

function add(level, name, details, fix = "") {
  if (level === "ERROR") hasError = true;
  if (level === "WARN") hasWarn = true;
  checks.push({ level, name, details, fix });
}

function exists(filePath) {
  return fs.existsSync(path.resolve(process.cwd(), filePath));
}

function read(filePath) {
  try {
    return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
  } catch {
    return "";
  }
}

function heading(text) {
  console.log(`\n## ${text}`);
}

function printCheck(check) {
  const icon = check.level === "OK" ? "✅" : check.level === "WARN" ? "⚠️" : "❌";
  console.log(`${icon} ${check.name}`);
  if (check.details) console.log(`   ${check.details}`);
  if (check.fix && check.level !== "OK") console.log(`   Fix: ${check.fix}`);
}

console.log("Soundshed Spark 2 Doctor\n");

const node = run("node", ["-v"]);
const npm = run("npm", ["-v"]);
const git = run("git", ["rev-parse", "--short", "HEAD"]);
const branch = run("git", ["branch", "--show-current"]);

if (node.code === 0) {
  const major = Number(node.stdout.replace(/^v/, "").split(".")[0]);
  if (major < 20) {
    add("ERROR", "Node version", `${node.stdout} is too old.`, "Install Node 20 or 22.");
  } else if (major > 22) {
    add("WARN", "Node version", `${node.stdout} works for many JS tasks, but Electron/native packages may be safer on Node 20 or 22.`, "If Electron/native modules fail, install Node 22 or 20.");
  } else {
    add("OK", "Node version", node.stdout);
  }
} else {
  add("ERROR", "Node version", "node command not found.", "Install Node 20+.");
}

if (npm.code === 0) add("OK", "npm version", npm.stdout);
else add("ERROR", "npm version", "npm command not found.", "Install npm with Node.");

if (git.code === 0) add("OK", "Git commit", `${git.stdout} on ${branch.stdout || "unknown branch"}`);
else add("WARN", "Git status", "Could not read git commit/branch.");

if (!exists("package.json")) {
  add("ERROR", "Repository root", "package.json not found.", "Run this from the soundshed-appspark2 repo root.");
} else {
  add("OK", "Repository root", "package.json found.");
}

if (!exists("node_modules")) {
  add("ERROR", "Dependencies", "node_modules missing.", "Run npm install.");
} else {
  add("OK", "Dependencies", "node_modules exists.");
}

const electronBinaryCandidates = [
  "node_modules/electron/dist/electron",
  "node_modules/electron/dist/electron.exe",
  "node_modules/electron/index.js"
];

if (electronBinaryCandidates.some(exists)) {
  add("OK", "Electron package", "Electron files found.");
} else {
  add("WARN", "Electron package", "Electron files were not found where expected.", "Run npm approve-scripts, then npm rebuild, then npm install.");
}

const env = read("src/env.ts");
if (env) {
  add(env.includes("IsWebMode: false") ? "OK" : "WARN", "Electron mode", env.includes("IsWebMode: false") ? "src/env.ts has IsWebMode false." : "src/env.ts still appears to be web mode.", "Set IsWebMode: false for Electron/Bazzite.");
  add(env.includes('SparkTransport: "ble"') ? "OK" : "WARN", "Spark transport", env.includes('SparkTransport: "ble"') ? "SparkTransport is ble." : "SparkTransport is not ble.", 'Set SparkTransport: "ble" for real hardware.');
} else {
  add("ERROR", "src/env.ts", "Missing or unreadable.", "Restore src/env.ts.");
}

const platform = read("src/core/platformUtils.ts");
if (platform) {
  add(platform.includes("platformUtils.electron") ? "OK" : "WARN", "Platform utils", platform.includes("platformUtils.electron") ? "Electron platform import is active." : "Web platform import appears active.", "Use platformUtils.electron for Electron/Bazzite.");
} else {
  add("ERROR", "platformUtils.ts", "Missing or unreadable.", "Restore src/core/platformUtils.ts.");
}

if (process.platform === "linux") {
  const osRelease = read("/etc/os-release");
  add(osRelease.toLowerCase().includes("bazzite") ? "OK" : "WARN", "Linux distro", osRelease.toLowerCase().includes("bazzite") ? "Bazzite detected." : "Bazzite was not detected from /etc/os-release.");

  const btService = run("systemctl", ["is-active", "bluetooth"]);
  add(btService.code === 0 ? "OK" : "WARN", "Bluetooth service", btService.stdout || btService.stderr || "unknown", "Start Bluetooth from KDE settings or run sudo systemctl start bluetooth.");

  const btShow = run("bluetoothctl", ["show"]);
  add(btShow.code === 0 ? "OK" : "WARN", "bluetoothctl show", btShow.stdout.split("\n").slice(0, 8).join(" | ") || btShow.stderr, "Make sure Bluetooth is enabled and your Spark 2 is not connected to the phone app.");

  const rfkill = run("rfkill", ["list", "bluetooth"]);
  add(rfkill.code === 0 && !rfkill.stdout.includes("Soft blocked: yes") && !rfkill.stdout.includes("Hard blocked: yes") ? "OK" : "WARN", "rfkill bluetooth", rfkill.stdout || rfkill.stderr, "Unblock Bluetooth in KDE settings or with rfkill unblock bluetooth.");
}

heading("Static checks");
for (const check of checks) printCheck(check);

heading("TypeScript checks");

const toolsCheck = run("npx", ["tsc", "-p", "tsconfig.tools.json", "--pretty", "false"]);
if (toolsCheck.code === 0) {
  printCheck({ level: "OK", name: "Tools TypeScript", details: "tsconfig.tools.json compiled." });
} else {
  hasError = true;
  printCheck({
    level: "ERROR",
    name: "Tools TypeScript",
    details: toolsCheck.stdout || toolsCheck.stderr,
    fix: "Fix the listed TypeScript errors, starting with src/core/aiToneConfig.ts."
  });
}

const appCheck = run("npx", ["tsc", "--pretty", "false"]);
if (appCheck.code === 0) {
  printCheck({ level: "OK", name: "App TypeScript", details: "Main app TypeScript compiled." });
} else {
  hasError = true;
  printCheck({
    level: "ERROR",
    name: "App TypeScript",
    details: appCheck.stdout || appCheck.stderr,
    fix: "Fix the listed TypeScript errors before npm run start-electron."
  });
}

heading("Summary");
if (hasError) {
  console.log("❌ Doctor found blocking errors.");
  process.exit(1);
}
if (hasWarn) {
  console.log("⚠️ Doctor found warnings but no blocking errors.");
  process.exit(0);
}
console.log("✅ Doctor found no obvious issues.");
