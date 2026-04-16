#!/usr/bin/env node
/**
 * generate-matrix.js
 * Fetches all Test_Case-labeled issues and writes:
 *   docs/test-matrix.json   — canonical data source
 *   docs/test-matrix.csv    — enriched CSV export (UTF-8 BOM, Excel-friendly)
 *   docs/index.html         — Dashboard SPA (overview, test-cases, coverage, guide)
 *   docs/test-matrix.html   — thin redirect → index.html (preserves old links)
 *
 * Env vars:
 *   GITHUB_TOKEN       — token with issues: read
 *   GITHUB_REPOSITORY  — "owner/repo"
 *   MOCK_ISSUES        — optional path to a JSON fixture (bypasses API, for local dev)
 */

import { writeFileSync, mkdirSync, readFileSync } from "fs";
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

// ── Fetch all Test_Case issues (paginated) ───────────────────────────────────
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function fetchAllIssues() {
  const mockPath = process.env.MOCK_ISSUES;
  if (mockPath) {
    const data = JSON.parse(readFileSync(resolve(root, mockPath), "utf8"));
    console.log(`Using mock data from ${mockPath}`);
    return data.filter((i) => !i.pull_request);
  }

  const results = [];
  let page = 1;
  while (true) {
    const url =
      `https://api.github.com/repos/${owner}/${repoName}/issues` +
      `?labels=Test_Case&state=all&per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    if (batch.length === 0) break;
    results.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
    page++;
  }
  return results;
}

// ── Parse issue body into { label: value } ───────────────────────────────────
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

function excerpt(s, n = 160) {
  if (!s) return "";
  const flat = String(s).replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : flat.slice(0, n - 1) + "…";
}

function daysSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

// ── Build row per issue ──────────────────────────────────────────────────────
function buildRow(issue) {
  const f = parseBody(issue.body);

  const epicValue = f["Epic"] || "";
  const epic = config.epics.find((e) => epicValue.includes(`(#${e.issue})`));
  const usValue = f["User Story"] || "";
  const us = config.userStories.find((u) => usValue.includes(`(#${u.issue})`));

  let status = "Not run";
  for (const label of (issue.labels || [])) {
    if (label.name.startsWith("status: ")) {
      status = label.name.slice(8);
      break;
    }
  }

  const bugFound = (issue.labels || []).some((l) => l.name === "bug-found");
  const description = isNoResponse(f["Description"]) ? "" : f["Description"].trim();

  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    state: issue.state,
    author: issue.user?.login || "",
    authorAvatar: issue.user?.avatar_url || "",
    assignees: (issue.assignees || []).map((a) => ({
      login: a.login,
      avatar: a.avatar_url,
    })),
    epic: epic ? epic.id : "",
    epicLabel: epic ? epic.label : "",
    userStory: us ? us.id : "",
    userStoryLabel: us ? us.label : "",
    testingType: isNoResponse(f["Testing Type"]) ? "" : f["Testing Type"].trim(),
    section: isNoResponse(f["Website Section"]) ? "" : f["Website Section"].trim(),
    environment: isNoResponse(f["Test Environment"]) ? "" : f["Test Environment"].trim(),
    os: isNoResponse(f["Environment Details"]) ? "" : (f["Environment Details"].match(/OS:\s*(.+)/i)?.[1]?.trim() || ""),
    browser: isNoResponse(f["Environment Details"]) ? "" : (f["Environment Details"].match(/Browser:\s*(.+)/i)?.[1]?.trim() || ""),
    description,
    descriptionExcerpt: excerpt(description, 160),
    status,
    bugFound,
    crossOs: (issue.labels || []).some((l) => l.name === "cross-os"),
    crossBrowser: (issue.labels || []).some((l) => l.name === "cross-browser"),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    daysSinceCreated: daysSince(issue.created_at),
    daysSinceUpdated: daysSince(issue.updated_at),
  };
}

// ── CSV output ───────────────────────────────────────────────────────────────
function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const STATUS_EMOJI = {
  "Not run": "⚪",
  "Passed": "✅",
  "Failed": "❌",
  "Blocked": "🟡",
  "Partially passed": "🟠",
};

function toCsv(rows) {
  const cols = [
    { key: "number",           label: "Issue #" },
    { key: "title",            label: "Title" },
    { key: "url",              label: "URL" },
    { key: "state",            label: "State" },
    { key: "status",           label: "Status" },
    { key: "statusEmoji",      label: "Status Icon" },
    { key: "epic",             label: "Epic ID" },
    { key: "epicLabel",        label: "Epic Label" },
    { key: "userStory",        label: "Story ID" },
    { key: "userStoryLabel",   label: "Story Label" },
    { key: "testingType",      label: "Testing Type" },
    { key: "section",          label: "Section" },
    { key: "environment",      label: "Environment" },
    { key: "os",               label: "OS" },
    { key: "browser",          label: "Browser" },
    { key: "author",           label: "Author" },
    { key: "assigneesList",    label: "Assignees" },
    { key: "assigneeCount",    label: "Assignee Count" },
    { key: "crossOs",          label: "Cross-OS" },
    { key: "crossBrowser",     label: "Cross-Browser" },
    { key: "bugFound",         label: "Bug Found" },
    { key: "descriptionExcerpt", label: "Description (excerpt)" },
    { key: "createdAt",        label: "Created At" },
    { key: "updatedAt",        label: "Updated At" },
    { key: "daysSinceCreated", label: "Days Open" },
    { key: "daysSinceUpdated", label: "Days Since Update" },
  ];

  const enrich = (r) => ({
    ...r,
    statusEmoji: STATUS_EMOJI[r.status] || "•",
    assigneesList: r.assignees.map((a) => a.login).join(" | "),
    assigneeCount: r.assignees.length,
    crossOs: r.crossOs ? "yes" : "no",
    crossBrowser: r.crossBrowser ? "yes" : "no",
    bugFound: r.bugFound ? "yes" : "no",
  });

  const header = cols.map((c) => csvEscape(c.label)).join(",");
  const body = rows
    .map(enrich)
    .map((r) => cols.map((c) => csvEscape(r[c.key])).join(","))
    .join("\r\n");

  // BOM for Excel / Google Sheets UTF-8 recognition
  return "\uFEFF" + header + "\r\n" + body + "\r\n";
}

// ── SPA HTML (file-based template assembly) ──────────────────────────────────
function htmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toSpa(rows) {
  const templateDir = resolve(__dirname, "dashboard");
  const templateHtml = readFileSync(resolve(templateDir, "template.html"), "utf8");
  const css = readFileSync(resolve(templateDir, "styles.css"), "utf8");
  const js = readFileSync(resolve(templateDir, "app.js"), "utf8");

  const payload = {
    repo,
    generatedAt: new Date().toISOString(),
    config: {
      epics: config.epics,
      userStories: config.userStories,
      testingTypes: config.testingTypes,
      websiteSections: config.websiteSections,
      environments: config.environments,
      executionStatuses: config.executionStatuses,
    },
    rows,
  };

  const dataJson = JSON.stringify(payload).replace(/</g, "\\u003c");

  return templateHtml
    .replace("{{CSS}}", css)
    .replace("{{JS}}", js)
    .replace("{{DATA}}", dataJson)
    .replace(/\{\{REPO\}\}/g, htmlEscape(repo));
}

// ── Main ─────────────────────────────────────────────────────────────────────
const issues = await fetchAllIssues();
console.log(`Fetched ${issues.length} Test_Case issues.`);

const rows = issues.map(buildRow);

const outDir = resolve(root, "docs");
mkdirSync(outDir, { recursive: true });

writeFileSync(resolve(outDir, "test-matrix.json"), JSON.stringify(rows, null, 2), "utf8");
writeFileSync(resolve(outDir, "test-matrix.csv"),  toCsv(rows), "utf8");
writeFileSync(resolve(outDir, "index.html"),       toSpa(rows), "utf8");

// Thin redirect — keep old bookmarks alive
const redirect = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Peviitor_TC — Redirecting…</title>
<meta http-equiv="refresh" content="0; url=index.html">
<link rel="canonical" href="index.html">
<style>body{font-family:'Inter',system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0f0f0f;color:#888}a{color:#3b82f6}</style>
</head>
<body><p>Redirecting to the <a href="index.html">dashboard</a>…</p></body>
</html>`;
writeFileSync(resolve(outDir, "test-matrix.html"), redirect, "utf8");

console.log(`✓ docs/test-matrix.json (${rows.length} rows)`);
console.log(`✓ docs/test-matrix.csv  (${rows.length} rows, enriched, BOM)`);
console.log(`✓ docs/index.html       (Dashboard SPA)`);
console.log(`✓ docs/test-matrix.html (redirect)`);
