#!/usr/bin/env node
/**
 * test-execution.js
 * Parses slash commands in issue comments and updates labels / posts summary.
 *
 * Commands:
 *   /status <not-run|passed|failed|blocked|partially-passed> [optional note]
 *   /bug #123  or  /bug <url>
 *   /cross-os           toggle cross-os flag
 *   /cross-browser      toggle cross-browser flag
 *
 * Multiple commands can appear in one comment; each is processed in order.
 *
 * Env vars (set by GitHub Actions):
 *   GITHUB_TOKEN
 *   GITHUB_REPOSITORY   "owner/repo"
 *   GITHUB_EVENT_PATH
 */

import { readFileSync } from "fs";

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;
if (!token || !repo || !eventPath) {
  console.error("Missing required env vars.");
  process.exit(1);
}

const event = JSON.parse(readFileSync(eventPath, "utf8"));

// Must be an issue comment on a Test_Case issue
if (!event.comment || !event.issue) {
  console.log("Not an issue comment event — skipping.");
  process.exit(0);
}
if ((event.issue.labels || []).every((l) => l.name !== "Test_Case")) {
  console.log("Issue is not a Test_Case — skipping.");
  process.exit(0);
}
// Ignore comments from the bot itself to prevent loops
if (event.comment.user?.type === "Bot") {
  console.log("Bot comment — skipping.");
  process.exit(0);
}

const [owner, repoName] = repo.split("/");
const issueNum = event.issue.number;
const commenter = event.comment.user.login;
const body = event.comment.body || "";

// ── Command grammar ──────────────────────────────────────────────────────────
const STATUS_MAP = {
  "not-run":          "Not run",
  "passed":           "Passed",
  "pass":             "Passed",
  "failed":           "Failed",
  "fail":             "Failed",
  "blocked":          "Blocked",
  "block":            "Blocked",
  "partially-passed": "Partially passed",
  "partial":          "Partially passed",
};

function parseCommands(text) {
  const commands = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("/")) continue;

    // /status <value> [note]
    const statusMatch = trimmed.match(/^\/status\s+([a-z-]+)\s*(.*)$/i);
    if (statusMatch) {
      const key = statusMatch[1].toLowerCase();
      const status = STATUS_MAP[key];
      if (status) {
        commands.push({ type: "status", value: status, note: statusMatch[2].trim() });
        // If the note contains a bug reference like "#123", also register a bug command
        const bugRef = statusMatch[2].match(/#(\d+)|\bhttps?:\/\/\S+/);
        if (bugRef) commands.push({ type: "bug", value: bugRef[0] });
        continue;
      }
    }

    // /bug <#123 or url>
    const bugMatch = trimmed.match(/^\/bug\s+(.+)$/i);
    if (bugMatch) {
      commands.push({ type: "bug", value: bugMatch[1].trim() });
      continue;
    }

    // /cross-os, /cross-browser (toggles)
    if (/^\/cross-os$/i.test(trimmed))       commands.push({ type: "toggle", flag: "cross-os" });
    if (/^\/cross-browser$/i.test(trimmed))  commands.push({ type: "toggle", flag: "cross-browser" });
  }
  return commands;
}

const commands = parseCommands(body);
if (commands.length === 0) {
  console.log("No slash commands found — skipping.");
  process.exit(0);
}
console.log(`Parsed ${commands.length} command(s):`, commands);

// ── GitHub API helpers ───────────────────────────────────────────────────────
const apiBase = `https://api.github.com/repos/${owner}/${repoName}/issues/${issueNum}`;
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

async function addLabels(labels) {
  if (!labels.length) return;
  const res = await fetch(`${apiBase}/labels`, {
    method: "POST", headers,
    body: JSON.stringify({ labels }),
  });
  if (!res.ok) throw new Error(`addLabels: ${res.status} ${await res.text()}`);
}

async function removeLabel(name) {
  const res = await fetch(`${apiBase}/labels/${encodeURIComponent(name)}`, {
    method: "DELETE", headers,
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`removeLabel: ${res.status} ${await res.text()}`);
  }
}

async function listLabels() {
  const res = await fetch(`${apiBase}/labels?per_page=100`, { headers });
  if (!res.ok) throw new Error(`listLabels: ${res.status} ${await res.text()}`);
  return (await res.json()).map((l) => l.name);
}

async function postComment(body) {
  const res = await fetch(`${apiBase}/comments`, {
    method: "POST", headers,
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`postComment: ${res.status} ${await res.text()}`);
}

// ── Apply commands ───────────────────────────────────────────────────────────
const current = new Set(await listLabels());
const toAdd = new Set();
const toRemove = new Set();
const actions = []; // for summary

let newStatus = null;
let previousStatus = null;
let bugRef = null;
let failedWithoutBug = false;

// Detect previous status from current labels
for (const s of Object.values(STATUS_MAP)) {
  const lbl = `status: ${s}`;
  if (current.has(lbl)) {
    previousStatus = s;
    break;
  }
}

for (const cmd of commands) {
  if (cmd.type === "status") {
    for (const s of Object.values(STATUS_MAP)) {
      const lbl = `status: ${s}`;
      if (current.has(lbl) || toAdd.has(lbl)) {
        toRemove.add(lbl);
        toAdd.delete(lbl);
      }
    }
    const targetLbl = `status: ${cmd.value}`;
    toAdd.add(targetLbl);
    toRemove.delete(targetLbl);
    newStatus = cmd.value;
    actions.push({ type: "status", value: cmd.value, note: cmd.note });

    // Check if failed without bug reference
    if (cmd.value === "Failed" && !cmd.note.match(/#\d+|\bhttps?:\/\/\S+/)) {
      failedWithoutBug = true;
    }
  } else if (cmd.type === "bug") {
    toAdd.add("bug-found");
    toRemove.delete("bug-found");
    bugRef = cmd.value;
    failedWithoutBug = false; // A bug was linked elsewhere in the comment
    actions.push({ type: "bug", value: cmd.value });
  } else if (cmd.type === "toggle") {
    const lbl = cmd.flag;
    if (current.has(lbl) || toAdd.has(lbl)) {
      toRemove.add(lbl);
      toAdd.delete(lbl);
      actions.push({ type: "toggle-off", flag: lbl });
    } else {
      toAdd.add(lbl);
      toRemove.delete(lbl);
      actions.push({ type: "toggle-on", flag: lbl });
    }
  }
}

await addLabels([...toAdd].filter((l) => !current.has(l)));
for (const l of toRemove) {
  if (current.has(l)) await removeLabel(l);
}

// ── Build summary comment ────────────────────────────────────────────────────
const STATUS_EMOJI = {
  "Not run":          "⚪",
  "Passed":           "✅",
  "Failed":           "❌",
  "Blocked":          "🟡",
  "Partially passed": "🟠",
};

const timestamp = new Date().toISOString().replace("T", " ").replace(/\.\d+Z/, " UTC");
const matrixUrl = `https://${owner}.github.io/${repoName}/test-matrix.html`;

const lines = [];
lines.push(`### Execution update`);
lines.push(`**By:** @${commenter} · **At:** \`${timestamp}\``);
lines.push("");

if (previousStatus && newStatus && previousStatus !== newStatus) {
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| **Previous status** | ${STATUS_EMOJI[previousStatus] || "•"} ${previousStatus} |`);
  lines.push(`| **New status** | ${STATUS_EMOJI[newStatus] || "•"} **${newStatus}** |`);
  lines.push("");
} else {
  for (const a of actions) {
    if (a.type === "status") {
      const emoji = STATUS_EMOJI[a.value] || "•";
      let line = `${emoji} Status → **${a.value}**`;
      if (a.note) line += ` — ${a.note}`;
      lines.push(line);
    }
  }
}

for (const a of actions) {
  if (a.type === "bug") {
    lines.push(`🐛 Bug linked: ${a.value}`);
  } else if (a.type === "toggle-on") {
    lines.push(`➕ Added flag \`${a.flag}\``);
  } else if (a.type === "toggle-off") {
    lines.push(`➖ Removed flag \`${a.flag}\``);
  }
}

// Warning if failed without bug reference
if (failedWithoutBug) {
  lines.push("");
  lines.push(`> ⚠️ **No bug reference found.** When marking a test as failed, please link the bug issue:`);
  lines.push(`> \`/bug #123\` or include it in the status command: \`/status failed #123\``);
}

lines.push("");
lines.push(`---`);
lines.push(`<sub>🔗 [View Test Matrix](${matrixUrl}) · Labels synced automatically</sub>`);

await postComment(lines.join("\n"));
console.log("Done.");
