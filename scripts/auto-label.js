#!/usr/bin/env node
/**
 * auto-label.js
 * Parses a Test Case issue body and syncs labels via the GitHub API.
 *
 * Scope:
 *   - Reconciles labels derived from form fields: epic:, story:, type:,
 *     section:, env:. Adds needs-review on Epic/US prefix mismatch.
 *   - Additive-only for cross-os and cross-browser (form ticks add them,
 *     but we don't remove them here — test-execution.js toggles these).
 *   - Does NOT manage status: or bug-found. Those are set via slash
 *     commands in issue comments by the Test Execution workflow.
 *
 * Env vars (set by GitHub Actions):
 *   GITHUB_TOKEN       — token with issues: write
 *   GITHUB_REPOSITORY  — "owner/repo"
 *   GITHUB_EVENT_PATH  — path to the event payload JSON
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;

if (!token || !repo || !eventPath) {
  console.error("Missing required env vars.");
  process.exit(1);
}

const event = JSON.parse(readFileSync(eventPath, "utf8"));
const issue = event.issue;
if (!issue) {
  console.log("No issue in event payload — skipping.");
  process.exit(0);
}

const hasTestCaseLabel = (issue.labels || []).some(
  (l) => l.name === "Test_Case"
);
if (!hasTestCaseLabel) {
  console.log("Issue lacks Test_Case label — skipping.");
  process.exit(0);
}

const config = JSON.parse(
  readFileSync(resolve(root, "config/epics-and-stories.json"), "utf8")
);

// ── Parse issue body ─────────────────────────────────────────────────────────
function parseBody(body) {
  const fields = {};
  if (!body) return fields;
  for (const part of body.split(/^###\s+/m).slice(1)) {
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    fields[part.slice(0, nl).trim()] = part.slice(nl + 1).trim();
  }
  return fields;
}

const isNoResponse = (v) => !v || /^_no response_$/i.test(v.trim());

// Returns true if a checkboxes-block value contains a ticked option matching `pattern`.
function isOptionChecked(value, pattern) {
  if (!value) return false;
  const lines = value.split(/\r?\n/);
  return lines.some(
    (l) => /^- \[x\]/i.test(l.trim()) && pattern.test(l)
  );
}

const fields = parseBody(issue.body);

// ── Compute desired labels (reconciled set) ──────────────────────────────────
const desired = new Set(["Test_Case"]);
// Additive-only labels (applied if form ticks; never removed by this script)
const additive = new Set();
const warnings = [];

// Epic
const epicValue = fields["Epic"];
let selectedEpicId = null;
if (!isNoResponse(epicValue)) {
  const epic = config.epics.find((e) => epicValue.includes(`(#${e.issue})`));
  if (epic) {
    selectedEpicId = epic.id;
    desired.add(`epic: ${epic.id}`);
  } else {
    warnings.push(`Could not match Epic: "${epicValue}"`);
  }
}

// User Story
const usValue = fields["User Story"];
let selectedUsEpicPrefix = null;
if (!isNoResponse(usValue)) {
  const us = config.userStories.find((u) => usValue.includes(`(#${u.issue})`));
  if (us) {
    selectedUsEpicPrefix = us.epicId;
    desired.add(`story: ${us.id}`);
  } else {
    warnings.push(`Could not match User Story: "${usValue}"`);
  }
}

// Epic/US mismatch
if (selectedEpicId && selectedUsEpicPrefix && selectedEpicId !== selectedUsEpicPrefix) {
  desired.add("needs-review");
  warnings.push(
    `Epic/US mismatch: Epic is ${selectedEpicId} but User Story belongs to ${selectedUsEpicPrefix}.`
  );
}

// Testing Type
const testingType = fields["Testing Type"];
if (!isNoResponse(testingType) && config.testingTypes.includes(testingType.trim())) {
  desired.add(`type: ${testingType.trim()}`);
}

// Section
const section = fields["Website Section"];
if (!isNoResponse(section) && config.websiteSections.includes(section.trim())) {
  desired.add(`section: ${section.trim()}`);
}

// Environment
const env = fields["Test Environment"];
if (!isNoResponse(env) && config.environments.includes(env.trim())) {
  desired.add(`env: ${env.trim()}`);
}

// Cross-platform coverage (additive-only)
const coverage = fields["Cross-platform Coverage"];
if (isOptionChecked(coverage, /operating systems/i)) additive.add("cross-os");
if (isOptionChecked(coverage, /browsers/i)) additive.add("cross-browser");

// Default status on first creation: Not run (additive-only — test-execution owns changes)
if (event.action === "opened") additive.add("status: Not run");

// ── Reconcile with existing labels ───────────────────────────────────────────
// We only remove labels with known prefixes. Flags (cross-os, cross-browser,
// bug-found, status:*) are never removed here.
const MANAGED_PREFIXES = ["epic: ", "story: ", "type: ", "section: ", "env: "];
const MANAGED_REMOVABLE_FLAGS = ["needs-review"];

function isManagedRemovable(name) {
  if (MANAGED_REMOVABLE_FLAGS.includes(name)) return true;
  return MANAGED_PREFIXES.some((p) => name.startsWith(p));
}

const current = new Set((issue.labels || []).map((l) => l.name));
const toAdd = [...desired, ...additive].filter((l) => !current.has(l));
const toRemove = [...current].filter(
  (l) => isManagedRemovable(l) && !desired.has(l)
);

console.log("Current labels:", [...current].join(", ") || "(none)");
console.log("Desired (reconciled):", [...desired].join(", "));
console.log("Additive:", [...additive].join(", ") || "(none)");
console.log("To add:   ", toAdd.join(", ") || "(none)");
console.log("To remove:", toRemove.join(", ") || "(none)");
if (warnings.length) console.log("Warnings:", warnings);

// ── Apply via GitHub API ─────────────────────────────────────────────────────
const [owner, repoName] = repo.split("/");
const apiBase = `https://api.github.com/repos/${owner}/${repoName}/issues/${issue.number}`;
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

async function addLabels(labels) {
  if (!labels.length) return;
  const res = await fetch(`${apiBase}/labels`, {
    method: "POST",
    headers,
    body: JSON.stringify({ labels }),
  });
  if (!res.ok) throw new Error(`Add labels failed: ${res.status} ${await res.text()}`);
}

async function removeLabel(name) {
  const res = await fetch(
    `${apiBase}/labels/${encodeURIComponent(name)}`,
    { method: "DELETE", headers }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Remove label failed: ${res.status} ${await res.text()}`);
  }
}

async function postWarningComment(messages) {
  const body = [
    "⚠️ **Auto-label warnings:**",
    ...messages.map((m) => `- ${m}`),
    "",
    "_Review the Epic/User Story selection or field values, then edit the issue to re-trigger auto-labelling._",
  ].join("\n");
  const res = await fetch(`${apiBase}/comments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`Post comment failed: ${res.status} ${await res.text()}`);
}

await addLabels(toAdd);
for (const l of toRemove) await removeLabel(l);
if (warnings.length && event.action === "opened") {
  await postWarningComment(warnings);
}

console.log("Done.");
