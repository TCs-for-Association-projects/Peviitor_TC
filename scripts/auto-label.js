#!/usr/bin/env node
/**
 * auto-label.js
 * Parses a Test Case issue body and syncs labels via the GitHub API.
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
// GitHub Issue Forms render each field as:
//   ### <Label>
//
//   <value>
//
// For unanswered optional fields, the value is "_No response_".
// For checkboxes, the value is "- [X] Label text" or "- [ ] Label text".
function parseBody(body) {
  const fields = {};
  if (!body) return fields;
  const parts = body.split(/^###\s+/m);
  for (const part of parts.slice(1)) {
    const nlIdx = part.indexOf("\n");
    if (nlIdx === -1) continue;
    const label = part.slice(0, nlIdx).trim();
    const value = part.slice(nlIdx + 1).trim();
    fields[label] = value;
  }
  return fields;
}

const fields = parseBody(issue.body);

function isChecked(value) {
  return /- \[x\]/i.test(value || "");
}

function isNoResponse(value) {
  return !value || /^_no response_$/i.test(value.trim());
}

// ── Compute desired labels ───────────────────────────────────────────────────
const desired = new Set(["Test_Case"]); // keep the gating label
const warnings = [];

// Epic — value looks like "Epic F1: Footer Navigation & Structure (#16)"
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

// User Story — value looks like "F1 · US1: Navigation links in footer (#17)"
const usValue = fields["User Story"];
let selectedUsEpicPrefix = null;
let selectedUsId = null;
if (!isNoResponse(usValue)) {
  const us = config.userStories.find((u) => usValue.includes(`(#${u.issue})`));
  if (us) {
    selectedUsId = us.id;
    selectedUsEpicPrefix = us.epicId;
    desired.add(`story: ${us.id}`);
  } else {
    warnings.push(`Could not match User Story: "${usValue}"`);
  }
}

// Cross-validate Epic vs US prefix
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

// Website Section
const section = fields["Website Section"];
if (!isNoResponse(section) && config.websiteSections.includes(section.trim())) {
  desired.add(`section: ${section.trim()}`);
}

// Environment (form label is "Test Environment")
const env = fields["Test Environment"];
if (!isNoResponse(env) && config.environments.includes(env.trim())) {
  desired.add(`env: ${env.trim()}`);
}

// Execution Status
const status = fields["Test Execution Status"];
if (!isNoResponse(status) && config.executionStatuses.includes(status.trim())) {
  desired.add(`status: ${status.trim()}`);
}

// Flag checkboxes
if (isChecked(fields["Cross-OS"])) desired.add("cross-os");
if (isChecked(fields["Cross-Browser"])) desired.add("cross-browser");
if (isChecked(fields["Bug Discovery Acknowledgement"])) desired.add("bug-found");

// ── Reconcile with existing labels ───────────────────────────────────────────
// We only manage labels with known prefixes + known flag names. Anything else
// is left alone (e.g. priority labels added by maintainers).
const MANAGED_PREFIXES = ["epic: ", "story: ", "type: ", "section: ", "env: ", "status: "];
const MANAGED_FLAGS = ["cross-os", "cross-browser", "bug-found", "needs-review"];

function isManaged(name) {
  if (MANAGED_FLAGS.includes(name)) return true;
  return MANAGED_PREFIXES.some((p) => name.startsWith(p));
}

const current = new Set((issue.labels || []).map((l) => l.name));
const toAdd = [...desired].filter((l) => !current.has(l));
const toRemove = [...current].filter(
  (l) => isManaged(l) && !desired.has(l)
);

console.log("Current labels:", [...current].join(", ") || "(none)");
console.log("Desired labels:", [...desired].join(", "));
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