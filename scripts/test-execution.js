#!/usr/bin/env node
/**
 * test-execution.js
 * Parses slash commands in issue comments and updates labels / posts summary.
 *
 * Commands:
 *   /status <not-run|passed|failed|blocked|partially-passed> [optional bug ref]
 *   /bug <url>           link a bug (cross-repo URL or same-repo #123)
 *   /note <text>         log an observation without changing status
 *   /cross-os            toggle cross-os flag
 *   /cross-browser       toggle cross-browser flag
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

// ── Bug reference helpers ────────────────────────────────────────────────────

/**
 * Parse a bug reference string into a display-friendly format.
 * Supports:
 *   - Full GitHub URL: https://github.com/org/repo/issues/42 → "org/repo#42"
 *   - Same-repo shorthand: #123 → "#123"
 *   - Any other URL: returned as-is
 */
function parseBugRef(raw) {
  if (!raw) return null;
  const val = raw.trim();

  // Full GitHub issue URL
  const ghMatch = val.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/i
  );
  if (ghMatch) {
    const [, bugOrg, bugRepo, bugNum] = ghMatch;
    // Same repo? Show shorthand
    if (bugOrg === owner && bugRepo === repoName) {
      return { display: `#${bugNum}`, url: val };
    }
    return { display: `${bugOrg}/${bugRepo}#${bugNum}`, url: val };
  }

  // Same-repo #123 shorthand
  const hashMatch = val.match(/^#(\d+)$/);
  if (hashMatch) {
    const url = `https://github.com/${owner}/${repoName}/issues/${hashMatch[1]}`;
    return { display: val, url };
  }

  // Generic URL
  if (/^https?:\/\//i.test(val)) {
    return { display: val, url: val };
  }

  // Unrecognized
  return { display: val, url: null };
}

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
        // If the note contains a bug reference, also register a bug command
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

    // /note <text>
    const noteMatch = trimmed.match(/^\/note\s+(.+)$/i);
    if (noteMatch) {
      commands.push({ type: "note", value: noteMatch[1].trim() });
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
    bugRef = parseBugRef(cmd.value);
    failedWithoutBug = false; // A bug was linked elsewhere in the comment
    actions.push({ type: "bug", value: cmd.value, parsed: bugRef });
  } else if (cmd.type === "note") {
    actions.push({ type: "note", value: cmd.value });
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

const dashboardUrl = `https://${owner}.github.io/${repoName}/`;

// Count how many "substantive" actions we have (excluding notes)
const substantiveActions = actions.filter(
  (a) => a.type === "status" || a.type === "bug" || a.type === "toggle-on" || a.type === "toggle-off"
);
const noteActions = actions.filter((a) => a.type === "note");
const isSimple = substantiveActions.length <= 2 && noteActions.length === 0;

const lines = [];

if (isSimple) {
  // ── Compact single-line format ──
  const parts = [];

  if (newStatus) {
    const emoji = STATUS_EMOJI[newStatus] || "•";
    // Suppress "Not run → X" — it's obvious you ran it
    if (previousStatus && previousStatus !== "Not run" && previousStatus !== newStatus) {
      parts.push(`${STATUS_EMOJI[previousStatus] || "•"} ~~${previousStatus}~~ → ${emoji} **${newStatus}**`);
    } else {
      parts.push(`${emoji} **${newStatus}**`);
    }
  }

  if (bugRef) {
    if (bugRef.url) {
      parts.push(`🐛 [${bugRef.display}](${bugRef.url})`);
    } else {
      parts.push(`🐛 ${bugRef.display}`);
    }
  }

  for (const a of actions) {
    if (a.type === "toggle-on") parts.push(`➕ \`${a.flag}\``);
    if (a.type === "toggle-off") parts.push(`➖ \`${a.flag}\``);
  }

  parts.push(`by @${commenter}`);
  lines.push(parts.join(" · "));

} else {
  // ── Multi-line format (many actions or notes present) ──
  lines.push(`### Execution update`);
  lines.push(`**By:** @${commenter}`);
  lines.push("");

  if (newStatus) {
    const emoji = STATUS_EMOJI[newStatus] || "•";
    // Show transition only between meaningful statuses (not from "Not run")
    if (previousStatus && previousStatus !== "Not run" && previousStatus !== newStatus) {
      lines.push(`${STATUS_EMOJI[previousStatus] || "•"} ~~${previousStatus}~~ → ${emoji} **${newStatus}**`);
    } else {
      lines.push(`${emoji} Status: **${newStatus}**`);
    }
    // Include note from status command if present
    const statusAction = actions.find((a) => a.type === "status" && a.note);
    if (statusAction?.note) lines.push(`> ${statusAction.note}`);
    lines.push("");
  }

  for (const a of actions) {
    if (a.type === "bug") {
      const parsed = a.parsed || parseBugRef(a.value);
      if (parsed?.url) {
        lines.push(`🐛 Bug linked: [${parsed.display}](${parsed.url})`);
      } else {
        lines.push(`🐛 Bug linked: ${a.value}`);
      }
    } else if (a.type === "toggle-on") {
      lines.push(`➕ Added flag \`${a.flag}\``);
    } else if (a.type === "toggle-off") {
      lines.push(`➖ Removed flag \`${a.flag}\``);
    } else if (a.type === "note") {
      lines.push(`📝 **Note:** ${a.value}`);
    }
  }
}

// Notes in compact mode get their own lines below
if (isSimple && noteActions.length > 0) {
  for (const a of noteActions) {
    lines.push(`📝 **Note:** ${a.value}`);
  }
}

// Warning if failed without bug reference
if (failedWithoutBug) {
  lines.push("");
  lines.push(`> ⚠️ **No bug linked.** Please provide one: \`/bug https://github.com/org/repo/issues/42\``);
}

lines.push("");
lines.push(`<sub>🔗 [Dashboard](${dashboardUrl}) · Labels synced</sub>`);

await postComment(lines.join("\n"));
console.log("Done.");
