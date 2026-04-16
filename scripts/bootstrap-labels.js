#!/usr/bin/env node
/**
 * bootstrap-labels.js
 * Creates (or updates) all managed labels via the GitHub API.
 * Idempotent — safe to re-run.
 *
 * Env vars:
 *   GITHUB_TOKEN       — token with issues: write
 *   GITHUB_REPOSITORY  — "owner/repo"
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (!token || !repo) {
  console.error("Missing GITHUB_TOKEN or GITHUB_REPOSITORY.");
  process.exit(1);
}
const [owner, repoName] = repo.split("/");

const config = JSON.parse(
  readFileSync(resolve(root, "config/epics-and-stories.json"), "utf8")
);

// ── Color palette (no '#', GitHub wants 6-hex) ───────────────────────────────
const COLORS = {
  gating:     "8b5cf6", // Test_Case — purple
  epic:       "1e3a8a", // dark blue
  story:      "60a5fa", // light blue
  type:       "0d9488", // teal
  section:    "ea580c", // orange
  envLocal:   "9ca3af", // gray
  envStaging: "eab308", // yellow
  envProd:    "dc2626", // red
  statusNot:  "9ca3af", // gray
  statusPass: "16a34a", // green
  statusFail: "dc2626", // red
  statusBlk:  "eab308", // yellow
  statusPart: "f97316", // orange
  crossOs:    "6366f1", // indigo
  crossBrow:  "8b5cf6", // violet
  bugFound:   "b91c1c", // deep red
  needsRev:   "facc15", // bright yellow
};

const ENV_COLORS = {
  Local: COLORS.envLocal,
  Staging: COLORS.envStaging,
  Production: COLORS.envProd,
};
const STATUS_COLORS = {
  "Not run": COLORS.statusNot,
  Passed: COLORS.statusPass,
  Failed: COLORS.statusFail,
  Blocked: COLORS.statusBlk,
  "Partially passed": COLORS.statusPart,
};

// ── Build the full label list ────────────────────────────────────────────────
const labels = [];

labels.push({
  name: "Test_Case",
  color: COLORS.gating,
  description: "Gating label — issue is processed by Test Case workflows",
});

for (const e of config.epics) {
  labels.push({
    name: `epic: ${e.id}`,
    color: COLORS.epic,
    description: `${e.label} (#${e.issue})`,
  });
}

for (const us of config.userStories) {
  labels.push({
    name: `story: ${us.id}`,
    color: COLORS.story,
    description: `${us.epicId} · ${us.label} (#${us.issue})`,
  });
}

for (const t of config.testingTypes) {
  labels.push({
    name: `type: ${t}`,
    color: COLORS.type,
    description: `Testing type: ${t}`,
  });
}

for (const s of config.websiteSections) {
  labels.push({
    name: `section: ${s}`,
    color: COLORS.section,
    description: `Website section: ${s}`,
  });
}

for (const env of config.environments) {
  labels.push({
    name: `env: ${env}`,
    color: ENV_COLORS[env] || COLORS.envLocal,
    description: `Test environment: ${env}`,
  });
}

for (const status of config.executionStatuses) {
  labels.push({
    name: `status: ${status}`,
    color: STATUS_COLORS[status] || COLORS.statusNot,
    description: `Execution status: ${status}`,
  });
}

labels.push(
  { name: "cross-os",      color: COLORS.crossOs,   description: "Should be run across multiple operating systems" },
  { name: "cross-browser", color: COLORS.crossBrow, description: "Should be run across multiple browsers" },
  { name: "bug-found",     color: COLORS.bugFound,  description: "A bug was discovered during this test" },
  { name: "needs-review",  color: COLORS.needsRev,  description: "Flagged by auto-label (e.g. Epic/US mismatch)" }
);

// ── API helpers ──────────────────────────────────────────────────────────────
const apiBase = `https://api.github.com/repos/${owner}/${repoName}/labels`;
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

async function upsertLabel({ name, color, description }) {
  // Try to create
  const createRes = await fetch(apiBase, {
    method: "POST",
    headers,
    body: JSON.stringify({ name, color, description }),
  });
  if (createRes.ok) return "created";
  if (createRes.status === 422) {
    // Already exists — update color/description
    const patchRes = await fetch(
      `${apiBase}/${encodeURIComponent(name)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ new_name: name, color, description }),
      }
    );
    if (patchRes.ok) return "updated";
    throw new Error(`PATCH ${name}: ${patchRes.status} ${await patchRes.text()}`);
  }
  throw new Error(`POST ${name}: ${createRes.status} ${await createRes.text()}`);
}

// ── Apply ────────────────────────────────────────────────────────────────────
console.log(`Bootstrapping ${labels.length} labels on ${repo}...\n`);

let created = 0, updated = 0, failed = 0;
for (const label of labels) {
  try {
    const result = await upsertLabel(label);
    if (result === "created") {
      created++;
      console.log(`  + ${label.name}`);
    } else {
      updated++;
      console.log(`  ~ ${label.name}`);
    }
  } catch (err) {
    failed++;
    console.error(`  ✗ ${label.name}: ${err.message}`);
  }
}

console.log(`\nDone. Created: ${created}  Updated: ${updated}  Failed: ${failed}`);
if (failed > 0) process.exit(1);