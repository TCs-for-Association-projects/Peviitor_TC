#!/usr/bin/env node
/**
 * generate-matrix.js
 * Fetches all Test_Case-labeled issues and writes:
 *   docs/test-matrix.json   — canonical data source
 *   docs/test-matrix.csv    — enriched CSV export (UTF-8 BOM, Excel-friendly)
 *   docs/index.html         — Criterium SPA dashboard (overview, test-cases, traceability, assignees)
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

// ── SPA HTML (Criterium dashboard) ───────────────────────────────────────────
function htmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toSpa(rows) {
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

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Peviitor_TC — Criterium Dashboard</title>
<meta name="description" content="Criterium-powered QA test dashboard for peviitor.ro.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"><\/script>
<style>${SPA_CSS}</style>
</head>
<body>
<div id="app-root">
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <div class="brand-logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      </div>
      <div>
        <div class="brand-name">Peviitor_TC</div>
        <div class="brand-sub">Test Management</div>
      </div>
    </div>

    <nav class="nav" aria-label="Primary">
      <a class="nav-item" data-route="overview" href="#/overview">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
        <span>Overview</span>
      </a>
      <a class="nav-item" data-route="test-cases" href="#/test-cases">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        <span>Test Cases</span>
      </a>
      <a class="nav-item" data-route="traceability" href="#/traceability">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M6 9v3a3 3 0 003 3h6a3 3 0 003-3V9"/></svg>
        <span>Traceability</span>
      </a>
      <a class="nav-item" data-route="assignees" href="#/assignees">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
        <span>Assignees</span>
      </a>
    </nav>

    <div class="sidebar-footer">
      <a href="https://github.com/${htmlEscape(repo)}" target="_blank" rel="noopener" class="repo-link">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.57.11.78-.25.78-.55 0-.27-.01-1.17-.01-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.67 1.24 3.32.95.1-.74.4-1.24.73-1.53-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18.92-.26 1.9-.38 2.88-.39.98.01 1.97.13 2.88.39 2.2-1.49 3.17-1.18 3.17-1.18.62 1.58.23 2.75.11 3.04.73.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.26 5.68.41.36.78 1.07.78 2.15 0 1.56-.01 2.82-.01 3.2 0 .31.21.67.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.73 18.27.5 12 .5z"/></svg>
        <span>View repo</span>
      </a>
      <div class="criterium">
        <div class="criterium-label">Powered by</div>
        <div class="criterium-brand">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          Criterium
        </div>
      </div>
    </div>
  </aside>

  <div class="main-wrap">
    <header class="topbar">
      <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <div class="breadcrumb" id="breadcrumb">
        <span class="crumb crumb-root">Peviitor_TC</span>
        <span class="crumb-sep">/</span>
        <span class="crumb crumb-page" id="crumb-page">Overview</span>
      </div>
      <div class="topbar-actions">
        <div class="search-wrap">
          <svg class="search-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="global-search" type="search" placeholder="Jump to test case — #, title, keyword" autocomplete="off">
          <kbd class="kbd">/</kbd>
        </div>
        <button class="icon-btn" id="theme-toggle" aria-label="Toggle theme" title="Toggle theme">
          <svg id="icon-moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
          <svg id="icon-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        </button>
      </div>
    </header>

    <main class="view-container" id="view"></main>

    <footer class="page-footer">
      <div>${htmlEscape(repo)} · <span id="footer-ts"></span></div>
      <div class="footer-right">
        <a href="test-matrix.csv" download>⬇ CSV</a>
        <span class="sep">·</span>
        <a href="test-matrix.json" download>⬇ JSON</a>
        <span class="sep">·</span>
        <span class="criterium-inline">Dashboard powered by <strong>Criterium</strong></span>
      </div>
    </footer>
  </div>

  <div class="search-results" id="search-results" hidden></div>
</div>

<script id="dashboard-data" type="application/json">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>
<script>${SPA_JS}</script>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// SPA CSS
// ══════════════════════════════════════════════════════════════════════════════
const SPA_CSS = `
:root, [data-theme="dark"] {
  --bg-app: #0b1220;
  --bg-sidebar: #0a0f1c;
  --bg-surface: #141b2d;
  --bg-surface-2: #1a2235;
  --bg-hover: #202a42;
  --bg-input: #1a2235;
  --border: #253148;
  --border-strong: #334159;
  --text: #e6ebf5;
  --text-muted: #8a96ac;
  --text-dim: #5e6a82;
  --text-heading: #f4f6fb;
  --accent: #4c9aff;
  --accent-strong: #2684ff;
  --accent-dim: rgba(76,154,255,0.14);
  --success: #36b37e;
  --danger: #ff5630;
  --warning: #ffab00;
  --info: #6554c0;
  --shadow-card: 0 1px 2px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.02);
  --shadow-pop: 0 10px 30px rgba(0,0,0,0.35);
}
[data-theme="light"] {
  --bg-app: #f4f5f7;
  --bg-sidebar: #172b4d;
  --bg-surface: #ffffff;
  --bg-surface-2: #fafbfc;
  --bg-hover: #f4f5f7;
  --bg-input: #f4f5f7;
  --border: #e1e5ec;
  --border-strong: #c1c7d0;
  --text: #172b4d;
  --text-muted: #5e6c84;
  --text-dim: #97a0af;
  --text-heading: #091e42;
  --accent: #0052cc;
  --accent-strong: #0747a6;
  --accent-dim: rgba(0,82,204,0.08);
  --shadow-card: 0 1px 2px rgba(9,30,66,0.08), 0 0 0 1px rgba(9,30,66,0.04);
  --shadow-pop: 0 8px 24px rgba(9,30,66,0.18);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  background: var(--bg-app);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  transition: background 0.2s ease, color 0.2s ease;
}
a { color: inherit; text-decoration: none; }
button { font: inherit; cursor: pointer; border: none; background: none; color: inherit; }
input, select { font: inherit; }
kbd {
  font-family: 'ui-monospace', 'SFMono-Regular', Menlo, monospace;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border-strong);
  background: var(--bg-surface-2);
  color: var(--text-muted);
}

/* ── Layout shell ─────────────────────────────────────────────────────────── */
#app-root {
  display: grid;
  grid-template-columns: 248px 1fr;
  min-height: 100vh;
}
.main-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* ── Sidebar ──────────────────────────────────────────────────────────────── */
.sidebar {
  background: var(--bg-sidebar);
  color: #cfd7e3;
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
  border-right: 1px solid rgba(255,255,255,0.04);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 8px 22px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 14px;
}
.brand-logo {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: linear-gradient(135deg, #2684ff 0%, #0052cc 100%);
  color: #fff;
  display: grid;
  place-items: center;
  box-shadow: 0 2px 6px rgba(0,82,204,0.4);
  flex-shrink: 0;
}
.brand-name {
  font-weight: 700;
  font-size: 14px;
  color: #fff;
  letter-spacing: -0.2px;
}
.brand-sub {
  font-size: 11px;
  color: #8a96ac;
  font-weight: 500;
  letter-spacing: 0.2px;
  text-transform: uppercase;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border-radius: 6px;
  font-size: 13.5px;
  font-weight: 500;
  color: #b9c3d4;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.nav-item:hover { background: rgba(255,255,255,0.05); color: #fff; }
.nav-item.active {
  background: rgba(76,154,255,0.15);
  color: #fff;
  font-weight: 600;
}
.nav-item.active svg { color: #4c9aff; }
.sidebar-footer {
  padding-top: 14px;
  border-top: 1px solid rgba(255,255,255,0.06);
  font-size: 12px;
  color: #8a96ac;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.repo-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 5px;
  color: #b9c3d4;
  transition: background 0.12s ease;
}
.repo-link:hover { background: rgba(255,255,255,0.05); color: #fff; }
.criterium {
  background: rgba(76,154,255,0.08);
  border: 1px solid rgba(76,154,255,0.18);
  padding: 9px 11px;
  border-radius: 7px;
}
.criterium-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: #8a96ac;
  margin-bottom: 3px;
  font-weight: 600;
}
.criterium-brand {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #4c9aff;
  font-weight: 700;
  font-size: 13px;
}

/* ── Topbar ───────────────────────────────────────────────────────────────── */
.topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 28px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 20;
  min-height: 62px;
}
.sidebar-toggle {
  display: none;
  color: var(--text-muted);
  padding: 6px;
  border-radius: 6px;
}
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  min-width: 0;
  flex-shrink: 1;
}
.crumb-root { color: var(--text-muted); font-weight: 500; }
.crumb-sep { color: var(--text-dim); }
.crumb-page { color: var(--text-heading); font-weight: 600; }
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
.search-wrap {
  position: relative;
  width: 340px;
  max-width: 44vw;
}
.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-dim);
  pointer-events: none;
}
#global-search {
  width: 100%;
  padding: 8px 38px 8px 34px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
#global-search:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-dim);
}
#global-search::placeholder { color: var(--text-dim); }
.search-wrap .kbd {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
}
.icon-btn {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  transition: background 0.12s ease, color 0.12s ease;
}
.icon-btn:hover { background: var(--bg-hover); color: var(--text-heading); }

/* ── Search results popover ──────────────────────────────────────────────── */
.search-results {
  position: fixed;
  top: 60px;
  right: 150px;
  width: 420px;
  max-height: 420px;
  overflow-y: auto;
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: var(--shadow-pop);
  z-index: 100;
  padding: 6px;
}
.search-result {
  display: block;
  padding: 9px 11px;
  border-radius: 5px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
}
.search-result:last-child { border-bottom: none; }
.search-result:hover { background: var(--bg-hover); }
.search-result-hdr {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}
.search-result-num {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  font-family: ui-monospace, monospace;
}
.search-result-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-heading);
}
.search-result-meta {
  font-size: 11px;
  color: var(--text-dim);
}
.search-empty {
  padding: 18px;
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
}

/* ── View container ──────────────────────────────────────────────────────── */
.view-container {
  flex: 1;
  padding: 28px;
  min-width: 0;
  animation: fadeIn 0.18s ease;
}
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

.view-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
  flex-wrap: wrap;
}
.view-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-heading);
  letter-spacing: -0.3px;
  margin-bottom: 2px;
}
.view-sub {
  font-size: 13px;
  color: var(--text-muted);
}
.view-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* ── Cards ───────────────────────────────────────────────────────────────── */
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  padding: 20px 22px;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 16px;
}
.card-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-heading);
  display: flex;
  align-items: center;
  gap: 8px;
}
.card-sub {
  font-size: 12px;
  color: var(--text-muted);
}

/* ── KPI grid ────────────────────────────────────────────────────────────── */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
  margin-bottom: 24px;
}
.kpi {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 18px;
  box-shadow: var(--shadow-card);
  position: relative;
  overflow: hidden;
  transition: transform 0.12s ease, border-color 0.12s ease;
}
.kpi:hover { transform: translateY(-1px); border-color: var(--border-strong); }
.kpi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}
.kpi-icon {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 14px;
}
.kpi-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-heading);
  line-height: 1;
}
.kpi-foot {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 6px;
}

/* ── Status breakdown bar (Jira-style segmented) ─────────────────────────── */
.status-breakdown {
  display: flex;
  gap: 3px;
  height: 28px;
  border-radius: 5px;
  overflow: hidden;
  margin: 6px 0 16px;
  background: var(--bg-input);
}
.status-seg {
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 11.5px;
  font-weight: 600;
  min-width: 4px;
  transition: flex-grow 0.3s ease;
  position: relative;
}
.status-seg:hover { filter: brightness(1.1); }
.status-legend {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-muted);
}
.status-legend-item { display: flex; align-items: center; gap: 6px; }
.status-legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.status-legend-num {
  color: var(--text-heading);
  font-weight: 600;
}

/* ── Chart grids ─────────────────────────────────────────────────────────── */
.two-col {
  display: grid;
  grid-template-columns: 1fr 1.7fr;
  gap: 18px;
  margin-bottom: 18px;
}
@media (max-width: 1100px) { .two-col { grid-template-columns: 1fr; } }

.mini-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
}
.mini-card { padding: 16px 18px; }
.mini-card h3 {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}
.mini-chart-wrap {
  position: relative;
  height: 180px;
}
.mini-total {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
}
.mini-total-num {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-heading);
  line-height: 1;
}
.mini-total-lbl {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 2px;
}

/* ── Filter bar (Test Cases) ─────────────────────────────────────────────── */
.filters {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 18px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 14px;
  box-shadow: var(--shadow-card);
}
.filters input[type="search"], .filters select {
  padding: 7px 11px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  min-width: 120px;
  transition: border-color 0.12s ease;
}
.filters input[type="search"] { flex: 1; min-width: 240px; }
.filters input[type="search"]:focus, .filters select:focus { border-color: var(--accent); }
.filters .chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 5px;
  border: 1px solid var(--border);
  font-size: 12.5px;
  cursor: pointer;
  background: var(--bg-input);
  user-select: none;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.filters .chk input { accent-color: var(--accent); margin: 0; }
.filters .chk:hover { border-color: var(--border-strong); }
.filters .chk.active { border-color: var(--accent); background: var(--accent-dim); color: var(--text-heading); }
.filters-meta {
  margin-left: auto;
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 12.5px;
  color: var(--text-muted);
}
.btn {
  padding: 7px 13px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 5px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.btn:hover { background: var(--bg-hover); border-color: var(--border-strong); }
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.btn.primary:hover { background: var(--accent-strong); border-color: var(--accent-strong); }

/* ── Data table ──────────────────────────────────────────────────────────── */
.table-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: var(--shadow-card);
}
.table-wrap { overflow-x: auto; }
table.data {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
table.data thead th {
  background: var(--bg-surface-2);
  color: var(--text-muted);
  font-weight: 600;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  padding: 11px 14px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
table.data thead th:hover { color: var(--text-heading); }
table.data thead th.sort-asc::after { content: " ↑"; color: var(--accent); }
table.data thead th.sort-desc::after { content: " ↓"; color: var(--accent); }
table.data tbody td {
  padding: 11px 14px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
table.data tbody tr { transition: background 0.1s ease; cursor: pointer; }
table.data tbody tr:hover { background: var(--bg-hover); }
table.data tbody tr.expanded { background: var(--accent-dim); }
table.data tbody tr:last-child td { border-bottom: none; }
.cell-title {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-heading);
  font-weight: 500;
}
.cell-num { font-family: ui-monospace, monospace; color: var(--text-muted); font-weight: 600; }
.cell-muted { color: var(--text-muted); font-size: 12px; }
tr.detail-row { display: none; background: var(--bg-surface-2); }
tr.detail-row.shown { display: table-row; }
tr.detail-row td {
  padding: 18px 20px;
  border-bottom: 1px solid var(--border);
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px 22px;
  font-size: 13px;
}
@media (max-width: 800px) { .detail-grid { grid-template-columns: 1fr; } }
.detail-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.detail-field-lbl {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}
.detail-field-val { color: var(--text); font-size: 13px; }
.detail-desc {
  grid-column: 1 / -1;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
}
.empty-state {
  padding: 60px 20px;
  text-align: center;
  color: var(--text-muted);
}
.empty-state-icon { font-size: 32px; margin-bottom: 8px; opacity: 0.5; }

/* ── Status pills ────────────────────────────────────────────────────────── */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  white-space: nowrap;
}
.pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}
.tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  background: var(--bg-input);
  color: var(--text-muted);
  border: 1px solid var(--border);
}
.tag-new {
  background: rgba(54,179,126,0.15);
  color: #36b37e;
  border-color: rgba(54,179,126,0.3);
}

/* ── Avatars ─────────────────────────────────────────────────────────────── */
.avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  vertical-align: middle;
  border: 1.5px solid var(--bg-surface);
}
.avatar-lg { width: 32px; height: 32px; border-width: 2px; }
.avatar-stack { display: inline-flex; }
.avatar-stack .avatar:not(:first-child) { margin-left: -6px; }
.author-cell {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
}

/* ── Traceability tree ───────────────────────────────────────────────────── */
.trace-epic {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 14px;
  overflow: hidden;
  box-shadow: var(--shadow-card);
}
.trace-epic-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  cursor: pointer;
  transition: background 0.12s ease;
}
.trace-epic-head:hover { background: var(--bg-hover); }
.trace-chevron {
  color: var(--text-muted);
  transition: transform 0.2s ease;
}
.trace-epic.open .trace-chevron { transform: rotate(90deg); }
.trace-epic-id {
  padding: 3px 9px;
  border-radius: 5px;
  background: rgba(38,132,255,0.14);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  font-family: ui-monospace, monospace;
}
.trace-epic-title {
  flex: 1;
  color: var(--text-heading);
  font-weight: 600;
  font-size: 14px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trace-epic-stats {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: var(--text-muted);
  align-items: center;
}
.trace-epic-pass {
  font-weight: 700;
  font-size: 14px;
  color: var(--text-heading);
}
.trace-epic-body {
  display: none;
  padding: 2px 20px 16px 48px;
  border-top: 1px solid var(--border);
}
.trace-epic.open .trace-epic-body { display: block; }
.trace-story {
  padding: 10px 0;
  border-bottom: 1px dashed var(--border);
}
.trace-story:last-child { border-bottom: none; }
.trace-story-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.trace-story-id {
  font-size: 11px;
  font-weight: 700;
  font-family: ui-monospace, monospace;
  color: var(--text-muted);
  padding: 2px 7px;
  border-radius: 4px;
  background: var(--bg-input);
}
.trace-story-label {
  color: var(--text);
  font-weight: 500;
  font-size: 13px;
  flex: 1;
}
.trace-story-count {
  font-size: 11.5px;
  color: var(--text-muted);
}
.trace-tcs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 8px;
  font-size: 12.5px;
}
.trace-tc {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.trace-tc a { color: var(--text); }
.trace-tc a:hover { color: var(--accent); }
.trace-tc-num {
  font-family: ui-monospace, monospace;
  color: var(--text-muted);
  font-size: 11.5px;
  min-width: 36px;
}
.trace-gap {
  padding: 10px;
  border-radius: 5px;
  background: rgba(255,171,0,0.08);
  border: 1px dashed rgba(255,171,0,0.3);
  color: var(--warning);
  font-size: 12.5px;
  font-style: italic;
}
.pass-bar {
  flex: 1;
  height: 6px;
  background: var(--bg-input);
  border-radius: 4px;
  overflow: hidden;
  min-width: 60px;
  max-width: 120px;
  display: flex;
}
.pass-bar-seg { height: 100%; }

/* ── Heatmap (traceability) ──────────────────────────────────────────────── */
.heatmap-wrap {
  overflow-x: auto;
}
.heatmap {
  border-collapse: separate;
  border-spacing: 2px;
  width: 100%;
  min-width: 620px;
}
.heatmap th {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 8px 6px;
  text-align: center;
  white-space: nowrap;
}
.heat-row-lbl {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text);
  padding: 6px 10px;
  text-align: left;
  white-space: nowrap;
}
.heat-cell {
  text-align: center;
  padding: 10px 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  border-radius: 5px;
  min-width: 56px;
  transition: transform 0.12s ease;
}
.heat-cell[data-count="0"] { color: var(--text-dim); font-weight: 400; }
.heat-cell:hover { transform: scale(1.08); }

/* ── Assignees view ──────────────────────────────────────────────────────── */
.assignee-top {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 18px;
  margin-bottom: 18px;
}
@media (max-width: 1000px) { .assignee-top { grid-template-columns: 1fr; } }
.assignee-list {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: var(--shadow-card);
}
.assignee-row {
  display: grid;
  grid-template-columns: 40px 1fr auto 280px;
  gap: 16px;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.12s ease;
}
.assignee-row:hover { background: var(--bg-hover); }
.assignee-row:last-child { border-bottom: none; }
.assignee-rank {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  color: var(--text-muted);
  font-weight: 700;
}
.assignee-info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.assignee-name {
  color: var(--text-heading);
  font-weight: 600;
  font-size: 14px;
}
.assignee-sub {
  font-size: 12px;
  color: var(--text-muted);
}
.assignee-percent {
  font-weight: 700;
  color: var(--text-heading);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.assignee-percent-sub {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: 4px;
  font-weight: 500;
}
.assignee-bar {
  display: flex;
  height: 10px;
  background: var(--bg-input);
  border-radius: 3px;
  overflow: hidden;
}
.assignee-bar-seg { height: 100%; transition: flex-grow 0.3s ease; }
.assignee-unassigned {
  background: rgba(255,86,48,0.08);
  border-top: 1px dashed rgba(255,86,48,0.3);
}
.assignee-unassigned .assignee-name { color: var(--danger); }

/* ── Recent activity ─────────────────────────────────────────────────────── */
.activity-list {
  display: flex;
  flex-direction: column;
}
.activity-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--border);
  font-size: 13px;
}
.activity-item:last-child { border-bottom: none; }
.activity-item a { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.activity-item a:hover { color: var(--accent); }
.activity-time {
  color: var(--text-dim);
  font-size: 11.5px;
  white-space: nowrap;
}

/* ── Footer ──────────────────────────────────────────────────────────────── */
.page-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  padding: 16px 28px;
  border-top: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-dim);
  background: var(--bg-surface);
}
.page-footer a { color: var(--accent); }
.page-footer .sep { margin: 0 6px; opacity: 0.5; }
.footer-right { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.criterium-inline { color: var(--text-muted); }
.criterium-inline strong { color: var(--accent); }

/* ── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  #app-root { grid-template-columns: 1fr; }
  .sidebar {
    position: fixed;
    left: -260px;
    top: 0;
    z-index: 50;
    width: 248px;
    transition: left 0.2s ease;
    box-shadow: var(--shadow-pop);
  }
  .sidebar.open { left: 0; }
  .sidebar-toggle { display: grid; place-items: center; }
  .view-container { padding: 18px; }
  .search-wrap { width: 200px; }
  .search-results { right: 12px; left: 12px; width: auto; }
  table.data { font-size: 12px; }
  .assignee-row { grid-template-columns: 32px 1fr 80px; }
  .assignee-row .assignee-bar { display: none; }
  .page-footer { flex-direction: column; text-align: center; }
}
`;

// ══════════════════════════════════════════════════════════════════════════════
// SPA JS
// ══════════════════════════════════════════════════════════════════════════════
const SPA_JS = `
(function() {
  const DATA = JSON.parse(document.getElementById('dashboard-data').textContent);
  const ROWS = DATA.rows;
  const CFG = DATA.config;
  const REPO = DATA.repo;

  const STATUS_COLORS = {
    'Not run':          '#8993a4',
    'Passed':           '#36b37e',
    'Failed':           '#ff5630',
    'Blocked':          '#ffab00',
    'Partially passed': '#ff8b00',
  };
  const STATUS_ICON = {
    'Not run':          '○',
    'Passed':           '✓',
    'Failed':           '✕',
    'Blocked':          '◐',
    'Partially passed': '◔',
  };

  // ── Palettes for dimensional charts ────────────────────────────────────────
  const PALETTE = ['#4c9aff','#36b37e','#ff5630','#ffab00','#6554c0','#00b8d9','#ff8b00','#8993a4','#f15bb5','#00c7b7'];

  // ── Helpers ────────────────────────────────────────────────────────────────
  const el = (tag, attrs, ...children) => {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'data') for (const [dk, dv] of Object.entries(v)) n.dataset[dk] = dv;
      else n.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  };
  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '';
  const relTime = (iso) => {
    if (!iso) return '';
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (d === 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 7) return d + 'd ago';
    if (d < 30) return Math.floor(d/7) + 'w ago';
    if (d < 365) return Math.floor(d/30) + 'mo ago';
    return Math.floor(d/365) + 'y ago';
  };

  const statusPill = (status) => {
    const c = STATUS_COLORS[status] || '#8993a4';
    return \`<span class="pill" style="background:\${c}20;color:\${c};border:1px solid \${c}44"><span class="pill-dot" style="background:\${c}"></span>\${escHtml(status)}</span>\`;
  };

  const charts = [];
  const destroyCharts = () => {
    while (charts.length) { try { charts.pop().destroy(); } catch(e) {} }
  };

  // ── Theme ──────────────────────────────────────────────────────────────────
  const root = document.documentElement;
  const savedTheme = localStorage.getItem('criterium-theme') || 'dark';
  root.setAttribute('data-theme', savedTheme);
  updateThemeIcon();
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('criterium-theme', next);
    updateThemeIcon();
    if (currentRoute) render(currentRoute);
  });
  function updateThemeIcon() {
    const isDark = root.getAttribute('data-theme') === 'dark';
    document.getElementById('icon-moon').style.display = isDark ? '' : 'none';
    document.getElementById('icon-sun').style.display  = isDark ? 'none' : '';
  }

  // ── Sidebar toggle (mobile) ────────────────────────────────────────────────
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // ── Global search (top bar) ────────────────────────────────────────────────
  const searchInput = document.getElementById('global-search');
  const searchResultsEl = document.getElementById('search-results');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { searchResultsEl.hidden = true; return; }
    const results = ROWS.filter(r => {
      return String(r.number).includes(q) ||
             r.title.toLowerCase().includes(q) ||
             (r.description || '').toLowerCase().includes(q) ||
             r.author.toLowerCase().includes(q);
    }).slice(0, 10);
    if (results.length === 0) {
      searchResultsEl.innerHTML = '<div class="search-empty">No test cases match "' + escHtml(searchInput.value) + '"</div>';
    } else {
      searchResultsEl.innerHTML = results.map(r => \`
        <a class="search-result" href="\${escHtml(r.url)}" target="_blank" rel="noopener">
          <div class="search-result-hdr">
            <span class="search-result-num">#\${r.number}</span>
            \${statusPill(r.status)}
          </div>
          <div class="search-result-title">\${escHtml(r.title)}</div>
          <div class="search-result-meta">\${escHtml(r.epic || '—')} · \${escHtml(r.userStory || '—')} · by \${escHtml(r.author)}</div>
        </a>\`).join('');
    }
    searchResultsEl.hidden = false;
  });
  document.addEventListener('click', (e) => {
    if (!searchResultsEl.contains(e.target) && e.target !== searchInput) searchResultsEl.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === 'Escape') { searchResultsEl.hidden = true; searchInput.blur(); }
  });

  // ── Footer timestamp ───────────────────────────────────────────────────────
  document.getElementById('footer-ts').textContent = 'Generated ' + new Date(DATA.generatedAt).toLocaleString('en-GB', { dateStyle:'medium', timeStyle:'short' });

  // ── Router ─────────────────────────────────────────────────────────────────
  let currentRoute = null;
  const ROUTES = { overview: renderOverview, 'test-cases': renderTestCases, traceability: renderTraceability, assignees: renderAssignees };
  function parseHash() {
    const [path, query] = (location.hash || '#/overview').slice(2).split('?');
    const params = new URLSearchParams(query || '');
    return { path: ROUTES[path] ? path : 'overview', params };
  }
  function render(route) {
    destroyCharts();
    currentRoute = route;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === route.path));
    document.getElementById('crumb-page').textContent = {
      'overview':'Overview','test-cases':'Test Cases','traceability':'Traceability','assignees':'Assignees'
    }[route.path];
    document.getElementById('view').replaceChildren();
    ROUTES[route.path](route.params);
    document.getElementById('sidebar').classList.remove('open');
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => render(parseHash()));
  if (!location.hash) location.hash = '#/overview';
  render(parseHash());

  // ══════════════════════════════════════════════════════════════════════════
  // View: OVERVIEW
  // ══════════════════════════════════════════════════════════════════════════
  function renderOverview() {
    const view = document.getElementById('view');
    const total = ROWS.length;

    const statusCounts = {};
    for (const s of CFG.executionStatuses) statusCounts[s] = 0;
    let bugs = 0, newRecent = 0;
    const nowMs = Date.now();
    for (const r of ROWS) {
      statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
      if (r.bugFound) bugs++;
      if (nowMs - new Date(r.createdAt).getTime() < 7 * 86400000) newRecent++;
    }
    const passed = statusCounts['Passed'] || 0;
    const passRate = total ? Math.round((passed / total) * 100) : 0;

    // View header
    view.appendChild(el('div', { class: 'view-header' },
      el('div', null,
        el('div', { class: 'view-title' }, 'Overview'),
        el('div', { class: 'view-sub' }, \`Snapshot of \${total} test case\${total === 1 ? '' : 's'} · \${bugs} bug\${bugs === 1 ? '' : 's'} found\`)
      ),
      el('div', { class: 'view-actions' },
        el('a', { class: 'btn', href: '#/test-cases' }, 'Browse test cases →')
      )
    ));

    // KPI cards
    const kpiGrid = el('div', { class: 'kpi-grid' });
    const kpis = [
      { label: 'Total', value: total, color: '#4c9aff', icon: '▣' },
      { label: 'Passed', value: passed, color: '#36b37e', icon: '✓' },
      { label: 'Failed', value: statusCounts['Failed'] || 0, color: '#ff5630', icon: '✕' },
      { label: 'Blocked', value: statusCounts['Blocked'] || 0, color: '#ffab00', icon: '◐' },
      { label: 'Not Run', value: statusCounts['Not run'] || 0, color: '#8993a4', icon: '○' },
      { label: 'Bugs', value: bugs, color: '#ff5630', icon: '🐛' },
      { label: 'New (7d)', value: newRecent, color: '#6554c0', icon: '✨' },
      { label: 'Pass Rate', value: passRate + '%', color: '#36b37e', icon: '⦿' },
    ];
    for (const k of kpis) {
      kpiGrid.innerHTML += \`
        <div class="kpi">
          <div class="kpi-top"><span>\${k.label}</span><span class="kpi-icon" style="background:\${k.color}22;color:\${k.color}">\${k.icon}</span></div>
          <div class="kpi-value">\${k.value}</div>
        </div>\`;
    }
    view.appendChild(kpiGrid);

    // Status breakdown (Jira-style segmented bar)
    const breakdownCard = el('div', { class: 'card' });
    breakdownCard.innerHTML = \`
      <div class="card-header">
        <div class="card-title">Execution status breakdown</div>
        <div class="card-sub">\${total} total</div>
      </div>
      <div class="status-breakdown" id="status-breakdown"></div>
      <div class="status-legend" id="status-legend"></div>\`;
    view.appendChild(breakdownCard);

    const seg = breakdownCard.querySelector('#status-breakdown');
    const legend = breakdownCard.querySelector('#status-legend');
    for (const s of CFG.executionStatuses) {
      const c = statusCounts[s] || 0;
      if (c > 0) {
        const pct = (c / total) * 100;
        const segEl = el('div', { class: 'status-seg', title: \`\${s}: \${c} (\${pct.toFixed(1)}%)\` });
        segEl.style.background = STATUS_COLORS[s];
        segEl.style.flex = c;
        segEl.textContent = pct > 8 ? c : '';
        seg.appendChild(segEl);
      }
      legend.innerHTML += \`<div class="status-legend-item"><span class="status-legend-dot" style="background:\${STATUS_COLORS[s]}"></span><span>\${s}</span><span class="status-legend-num">\${c}</span></div>\`;
    }

    // Two-column row: epic stacked bar + recent activity
    const twoCol = el('div', { class: 'two-col' });

    const epicCard = el('div', { class: 'card' });
    epicCard.innerHTML = \`
      <div class="card-header"><div class="card-title">Test cases by Epic</div><div class="card-sub">status breakdown</div></div>
      <div style="height: 280px; position: relative;"><canvas id="chart-epic"></canvas></div>\`;
    twoCol.appendChild(epicCard);

    const activityCard = el('div', { class: 'card' });
    activityCard.innerHTML = \`<div class="card-header"><div class="card-title">Recent activity</div><div class="card-sub">last updated</div></div>\`;
    const sortedByUpdate = [...ROWS].sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 8);
    const actList = el('div', { class: 'activity-list' });
    for (const r of sortedByUpdate) {
      actList.innerHTML += \`
        <div class="activity-item">
          \${statusPill(r.status)}
          <a href="\${escHtml(r.url)}" target="_blank" rel="noopener" title="\${escHtml(r.title)}">#\${r.number} — \${escHtml(r.title)}</a>
          <span class="activity-time">\${relTime(r.updatedAt)}</span>
        </div>\`;
    }
    activityCard.appendChild(actList);
    twoCol.appendChild(activityCard);
    view.appendChild(twoCol);

    // Small multiples: breakdown pies by dimension
    const miniHdr = el('div', { class: 'card-header', style: 'margin: 24px 2px 10px' },
      el('div', { class: 'card-title' }, 'Distribution across dimensions')
    );
    view.appendChild(miniHdr);

    const miniGrid = el('div', { class: 'mini-grid' });
    const dims = [
      { key: 'environment', title: 'Environment', values: CFG.environments },
      { key: 'testingType', title: 'Testing Type', values: CFG.testingTypes },
      { key: 'section',     title: 'Section',     values: CFG.websiteSections },
      { key: 'os',          title: 'Operating System' },
      { key: 'browser',     title: 'Browser' },
      { key: 'userStory',   title: 'User Story (top 8)' },
    ];
    for (const d of dims) {
      const card = el('div', { class: 'card mini-card' });
      card.innerHTML = \`<h3>\${d.title}</h3><div class="mini-chart-wrap"><canvas id="mini-\${d.key}"></canvas><div class="mini-total" id="mt-\${d.key}"></div></div>\`;
      miniGrid.appendChild(card);
    }
    view.appendChild(miniGrid);

    // ── Render charts ────────────────────────────────────────────────────────
    queueMicrotask(() => {
      const txt = getCss('--text'), muted = getCss('--text-muted'), grid = getCss('--border');

      // Epic stacked bar
      const epicMap = {};
      for (const r of ROWS) {
        if (!r.epic) continue;
        if (!epicMap[r.epic]) { epicMap[r.epic] = { label: r.epicLabel, ts: {} }; for (const s of CFG.executionStatuses) epicMap[r.epic].ts[s] = 0; }
        epicMap[r.epic].ts[r.status] = (epicMap[r.epic].ts[r.status] || 0) + 1;
      }
      const epicKeys = Object.keys(epicMap);
      charts.push(new Chart(document.getElementById('chart-epic'), {
        type: 'bar',
        data: {
          labels: epicKeys,
          datasets: CFG.executionStatuses.map(s => ({
            label: s,
            data: epicKeys.map(k => epicMap[k].ts[s] || 0),
            backgroundColor: STATUS_COLORS[s],
            borderWidth: 0,
            borderRadius: 3,
          })),
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          indexAxis: 'y',
          scales: {
            x: { stacked: true, beginAtZero: true, grid: { color: grid }, ticks: { color: muted, precision: 0 } },
            y: { stacked: true, grid: { display: false }, ticks: { color: muted, font: { weight: 600 } } },
          },
          plugins: {
            legend: { position: 'bottom', labels: { color: txt, usePointStyle: true, pointStyleWidth: 8, font: { size: 11 }, padding: 12 } },
            tooltip: tooltipStyle(),
          },
        },
      }));

      // Mini donuts
      for (const d of dims) {
        const agg = {};
        for (const r of ROWS) {
          const v = r[d.key] || '—';
          agg[v] = (agg[v] || 0) + 1;
        }
        let entries = Object.entries(agg).filter(([k]) => k && k !== '—').sort((a,b) => b[1]-a[1]);
        if (d.values && d.key !== 'userStory') {
          entries = d.values.filter(v => agg[v]).map(v => [v, agg[v]]);
        } else if (d.key === 'userStory') {
          entries = entries.slice(0, 8);
        }
        const total = entries.reduce((s,[,c]) => s + c, 0);
        document.getElementById('mt-' + d.key).innerHTML = \`<div class="mini-total-num">\${total}</div><div class="mini-total-lbl">Total</div>\`;
        charts.push(new Chart(document.getElementById('mini-' + d.key), {
          type: 'doughnut',
          data: {
            labels: entries.map(([k]) => k),
            datasets: [{
              data: entries.map(([,c]) => c),
              backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length]),
              borderColor: getCss('--bg-surface'),
              borderWidth: 2,
              hoverOffset: 4,
            }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
              legend: { position: 'bottom', labels: { color: txt, usePointStyle: true, pointStyleWidth: 7, font: { size: 10 }, padding: 8, boxWidth: 7 } },
              tooltip: tooltipStyle(),
            },
          },
        }));
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // View: TEST CASES
  // ══════════════════════════════════════════════════════════════════════════
  function renderTestCases(params) {
    const view = document.getElementById('view');
    const filters = {
      search: params.get('search') || '',
      epic: params.get('epic') || '',
      story: params.get('story') || '',
      status: params.get('status') || '',
      section: params.get('section') || '',
      env: params.get('env') || '',
      type: params.get('type') || '',
      author: params.get('author') || '',
      assignee: params.get('assignee') || '',
      newOnly: params.get('new') === '1',
    };

    view.appendChild(el('div', { class: 'view-header' },
      el('div', null,
        el('div', { class: 'view-title' }, 'Test Cases'),
        el('div', { class: 'view-sub' }, \`Browse, filter, and search all \${ROWS.length} test cases\`)
      ),
      el('div', { class: 'view-actions' },
        el('a', { class: 'btn', href: 'test-matrix.csv', download: '' }, '⬇ Export CSV')
      )
    ));

    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
    const opts = {
      epic:     uniq(ROWS.map(r => r.epic)),
      story:    uniq(ROWS.map(r => r.userStory)),
      status:   uniq(ROWS.map(r => r.status)),
      section:  uniq(ROWS.map(r => r.section)),
      env:      uniq(ROWS.map(r => r.environment)),
      type:     uniq(ROWS.map(r => r.testingType)),
      author:   uniq(ROWS.map(r => r.author)),
      assignee: uniq(ROWS.flatMap(r => r.assignees.map(a => a.login))),
    };
    const optHtml = (arr, selected) => arr.map(v => \`<option value="\${escHtml(v)}"\${v === selected ? ' selected' : ''}>\${escHtml(v)}</option>\`).join('');

    const filterBar = el('div', { class: 'filters' });
    filterBar.innerHTML = \`
      <input type="search" id="ft-search" placeholder="Search title, description, #number…" value="\${escHtml(filters.search)}">
      <select id="ft-epic"><option value="">All Epics</option>\${optHtml(opts.epic, filters.epic)}</select>
      <select id="ft-story"><option value="">All Stories</option>\${optHtml(opts.story, filters.story)}</select>
      <select id="ft-status"><option value="">All Statuses</option>\${optHtml(opts.status, filters.status)}</select>
      <select id="ft-section"><option value="">All Sections</option>\${optHtml(opts.section, filters.section)}</select>
      <select id="ft-env"><option value="">All Envs</option>\${optHtml(opts.env, filters.env)}</select>
      <select id="ft-type"><option value="">All Types</option>\${optHtml(opts.type, filters.type)}</select>
      <select id="ft-author"><option value="">All Authors</option>\${optHtml(opts.author, filters.author)}</select>
      <select id="ft-assignee"><option value="">All Assignees</option>\${optHtml(opts.assignee, filters.assignee)}</select>
      <label class="chk \${filters.newOnly ? 'active' : ''}"><input type="checkbox" id="ft-new" \${filters.newOnly ? 'checked' : ''}> ✨ New (7d)</label>
      <div class="filters-meta">
        <span id="row-count">0 of \${ROWS.length}</span>
        <button class="btn" id="reset-filters">Reset</button>
      </div>\`;
    view.appendChild(filterBar);

    const tableCard = el('div', { class: 'table-card' });
    tableCard.innerHTML = \`
      <div class="table-wrap">
        <table class="data" id="tc-table">
          <thead><tr>
            <th data-col="number" data-type="num">#</th>
            <th data-col="title">Title</th>
            <th data-col="epic">Epic</th>
            <th data-col="userStory">Story</th>
            <th data-col="status">Status</th>
            <th data-col="testingType">Type</th>
            <th data-col="section">Section</th>
            <th data-col="environment">Env</th>
            <th data-col="author">Author</th>
            <th>Assignees</th>
            <th data-col="createdAt" data-type="date">Created</th>
          </tr></thead>
          <tbody id="tc-body"></tbody>
        </table>
      </div>\`;
    view.appendChild(tableCard);

    const nowMs = Date.now();
    let sortCol = 'number', sortAsc = false;

    const renderRows = () => {
      const q = (document.getElementById('ft-search').value || '').toLowerCase();
      const get = (id) => document.getElementById('ft-' + id).value;
      const newOnly = document.getElementById('ft-new').checked;
      const crit = { epic: get('epic'), story: get('story'), status: get('status'), section: get('section'), env: get('env'), type: get('type'), author: get('author'), assignee: get('assignee') };

      let list = ROWS.filter(r => {
        if (crit.epic && r.epic !== crit.epic) return false;
        if (crit.story && r.userStory !== crit.story) return false;
        if (crit.status && r.status !== crit.status) return false;
        if (crit.section && r.section !== crit.section) return false;
        if (crit.env && r.environment !== crit.env) return false;
        if (crit.type && r.testingType !== crit.type) return false;
        if (crit.author && r.author !== crit.author) return false;
        if (crit.assignee && !r.assignees.some(a => a.login === crit.assignee)) return false;
        if (newOnly && nowMs - new Date(r.createdAt).getTime() > 7 * 86400000) return false;
        if (q) {
          const hay = (r.title + ' ' + r.description + ' ' + r.number + ' ' + r.author).toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      list.sort((a, b) => {
        let av = a[sortCol], bv = b[sortCol];
        if (sortCol === 'createdAt') { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
        if (typeof av === 'number') return sortAsc ? av - bv : bv - av;
        return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });

      const body = document.getElementById('tc-body');
      if (list.length === 0) {
        body.innerHTML = '<tr><td colspan="11"><div class="empty-state"><div class="empty-state-icon">📭</div>No test cases match the current filters.</div></td></tr>';
      } else {
        body.innerHTML = list.map(r => {
          const isNew = nowMs - new Date(r.createdAt).getTime() < 7 * 86400000;
          const assigneesHtml = r.assignees.length ? \`<span class="avatar-stack">\${r.assignees.map(a => \`<img class="avatar" src="\${escHtml(a.avatar)}&s=44" alt="\${escHtml(a.login)}" title="\${escHtml(a.login)}">\`).join('')}</span>\` : '<span class="cell-muted">—</span>';
          const authorHtml = r.author ? \`<span class="author-cell"><img class="avatar" src="\${escHtml(r.authorAvatar)}&s=44" alt="\${escHtml(r.author)}"> \${escHtml(r.author)}</span>\` : '';
          return \`
            <tr data-num="\${r.number}">
              <td class="cell-num">#\${r.number}</td>
              <td class="cell-title">\${isNew ? '<span class="tag tag-new" title="Created in last 7 days">NEW</span> ' : ''}\${escHtml(r.title)}\${r.bugFound ? ' 🐛' : ''}</td>
              <td><span class="tag">\${escHtml(r.epic || '—')}</span></td>
              <td><span class="tag">\${escHtml(r.userStory || '—')}</span></td>
              <td>\${statusPill(r.status)}</td>
              <td class="cell-muted">\${escHtml(r.testingType)}</td>
              <td class="cell-muted">\${escHtml(r.section)}</td>
              <td class="cell-muted">\${escHtml(r.environment)}</td>
              <td>\${authorHtml}</td>
              <td>\${assigneesHtml}</td>
              <td class="cell-muted">\${fmtDate(r.createdAt)}</td>
            </tr>
            <tr class="detail-row" data-detail="\${r.number}"><td colspan="11">
              <div class="detail-grid">
                <div class="detail-field"><div class="detail-field-lbl">Epic</div><div class="detail-field-val">\${escHtml(r.epicLabel || '—')}</div></div>
                <div class="detail-field"><div class="detail-field-lbl">User Story</div><div class="detail-field-val">\${escHtml(r.userStoryLabel || '—')}</div></div>
                <div class="detail-field"><div class="detail-field-lbl">OS / Browser</div><div class="detail-field-val">\${escHtml(r.os || '—')} / \${escHtml(r.browser || '—')}</div></div>
                <div class="detail-field"><div class="detail-field-lbl">Flags</div><div class="detail-field-val">\${r.crossOs ? '<span class="tag">cross-os</span> ' : ''}\${r.crossBrowser ? '<span class="tag">cross-browser</span>' : ''}\${!r.crossOs && !r.crossBrowser ? '—' : ''}</div></div>
                <div class="detail-field"><div class="detail-field-lbl">Updated</div><div class="detail-field-val">\${fmtDate(r.updatedAt)} (\${relTime(r.updatedAt)})</div></div>
                <div class="detail-field"><div class="detail-field-lbl">State</div><div class="detail-field-val">\${escHtml(r.state)}</div></div>
                <div class="detail-field detail-desc"><div class="detail-field-lbl">Description</div><div class="detail-field-val">\${escHtml(r.description || 'No description provided.')}</div></div>
                <div class="detail-field detail-desc"><a class="btn primary" href="\${escHtml(r.url)}" target="_blank" rel="noopener" style="width: fit-content">Open issue on GitHub →</a></div>
              </div>
            </td></tr>\`;
        }).join('');
        body.querySelectorAll('tr[data-num]').forEach(tr => {
          tr.addEventListener('click', (e) => {
            if (e.target.closest('a, button')) return;
            const detail = body.querySelector(\`tr[data-detail="\${tr.dataset.num}"]\`);
            detail.classList.toggle('shown');
            tr.classList.toggle('expanded');
          });
        });
      }
      document.getElementById('row-count').textContent = list.length + ' of ' + ROWS.length;
    };

    const updateUrl = () => {
      const q = new URLSearchParams();
      const keys = { search: 'ft-search', epic: 'ft-epic', story: 'ft-story', status: 'ft-status', section: 'ft-section', env: 'ft-env', type: 'ft-type', author: 'ft-author', assignee: 'ft-assignee' };
      for (const [k, id] of Object.entries(keys)) {
        const v = document.getElementById(id).value;
        if (v) q.set(k, v);
      }
      if (document.getElementById('ft-new').checked) q.set('new', '1');
      const qs = q.toString();
      const newHash = '#/test-cases' + (qs ? '?' + qs : '');
      if (location.hash !== newHash) history.replaceState(null, '', newHash);
    };

    ['search','epic','story','status','section','env','type','author','assignee'].forEach(k => {
      const el2 = document.getElementById('ft-' + k);
      el2.addEventListener('input', () => { updateUrl(); renderRows(); });
      el2.addEventListener('change', () => { updateUrl(); renderRows(); });
    });
    document.getElementById('ft-new').addEventListener('change', (e) => {
      e.target.closest('label').classList.toggle('active', e.target.checked);
      updateUrl(); renderRows();
    });
    document.getElementById('reset-filters').addEventListener('click', () => {
      ['ft-search','ft-epic','ft-story','ft-status','ft-section','ft-env','ft-type','ft-author','ft-assignee'].forEach(id => { document.getElementById(id).value = ''; });
      const chk = document.getElementById('ft-new');
      chk.checked = false; chk.closest('label').classList.remove('active');
      updateUrl(); renderRows();
    });

    document.querySelectorAll('#tc-table thead th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sortCol === col) sortAsc = !sortAsc; else { sortCol = col; sortAsc = true; }
        document.querySelectorAll('#tc-table thead th').forEach(t => t.classList.remove('sort-asc','sort-desc'));
        th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
        renderRows();
      });
    });

    renderRows();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // View: TRACEABILITY
  // ══════════════════════════════════════════════════════════════════════════
  function renderTraceability() {
    const view = document.getElementById('view');

    view.appendChild(el('div', { class: 'view-header' },
      el('div', null,
        el('div', { class: 'view-title' }, 'Traceability'),
        el('div', { class: 'view-sub' }, 'Epic → User Story → Test Cases. Gaps in coverage are highlighted.')
      )
    ));

    // Build tree
    const byEpic = {};
    for (const e of CFG.epics) byEpic[e.id] = { meta: e, stories: {}, orphans: [] };
    for (const us of CFG.userStories) {
      if (byEpic[us.epicId]) byEpic[us.epicId].stories[us.id] = { meta: us, tcs: [] };
    }
    for (const r of ROWS) {
      if (r.epic && byEpic[r.epic]) {
        if (r.userStory && byEpic[r.epic].stories[r.userStory]) byEpic[r.epic].stories[r.userStory].tcs.push(r);
        else byEpic[r.epic].orphans.push(r);
      }
    }

    for (const epicId of Object.keys(byEpic)) {
      const node = byEpic[epicId];
      const allTcs = Object.values(node.stories).flatMap(s => s.tcs).concat(node.orphans);
      const totals = { total: allTcs.length, passed: 0, failed: 0, blocked: 0, partial: 0, notrun: 0 };
      for (const t of allTcs) {
        if (t.status === 'Passed') totals.passed++;
        else if (t.status === 'Failed') totals.failed++;
        else if (t.status === 'Blocked') totals.blocked++;
        else if (t.status === 'Partially passed') totals.partial++;
        else totals.notrun++;
      }
      const executed = totals.passed + totals.failed + totals.blocked + totals.partial;
      const passRate = executed ? Math.round((totals.passed / executed) * 100) : 0;

      const epicCard = el('div', { class: 'trace-epic' });
      const passBarHtml = \`<div class="pass-bar">
        \${totals.passed ? \`<div class="pass-bar-seg" style="flex:\${totals.passed};background:\${STATUS_COLORS.Passed}"></div>\` : ''}
        \${totals.partial ? \`<div class="pass-bar-seg" style="flex:\${totals.partial};background:\${STATUS_COLORS['Partially passed']}"></div>\` : ''}
        \${totals.failed ? \`<div class="pass-bar-seg" style="flex:\${totals.failed};background:\${STATUS_COLORS.Failed}"></div>\` : ''}
        \${totals.blocked ? \`<div class="pass-bar-seg" style="flex:\${totals.blocked};background:\${STATUS_COLORS.Blocked}"></div>\` : ''}
        \${totals.notrun ? \`<div class="pass-bar-seg" style="flex:\${totals.notrun};background:\${STATUS_COLORS['Not run']}"></div>\` : ''}
      </div>\`;
      epicCard.innerHTML = \`
        <div class="trace-epic-head">
          <svg class="trace-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <span class="trace-epic-id">\${escHtml(epicId)}</span>
          <span class="trace-epic-title">\${escHtml(node.meta.label)}</span>
          <span class="trace-epic-stats">
            \${passBarHtml}
            <span><span class="trace-epic-pass">\${totals.total}</span> tc\${totals.total === 1 ? '' : 's'}</span>
            <span>\${executed}/\${totals.total} executed · \${passRate}% pass</span>
          </span>
        </div>
        <div class="trace-epic-body"></div>\`;

      const body = epicCard.querySelector('.trace-epic-body');
      const stories = Object.values(node.stories);
      if (stories.length === 0 && node.orphans.length === 0) {
        body.innerHTML = '<div class="trace-gap">⚠ No test cases mapped to this epic yet.</div>';
      } else {
        for (const s of stories) {
          const storyBlock = el('div', { class: 'trace-story' });
          const storyCounts = { total: s.tcs.length };
          storyBlock.innerHTML = \`
            <div class="trace-story-head">
              <span class="trace-story-id">\${escHtml(s.meta.id)}</span>
              <span class="trace-story-label">\${escHtml(s.meta.label)}</span>
              <span class="trace-story-count">\${storyCounts.total} tc\${storyCounts.total === 1 ? '' : 's'}</span>
            </div>\`;
          if (s.tcs.length === 0) {
            storyBlock.innerHTML += '<div class="trace-gap">⚠ No test cases cover this story yet.</div>';
          } else {
            const tcs = el('div', { class: 'trace-tcs' });
            for (const tc of s.tcs.sort((a,b) => a.number - b.number)) {
              tcs.innerHTML += \`<div class="trace-tc"><span class="trace-tc-num">#\${tc.number}</span>\${statusPill(tc.status)}<a href="\${escHtml(tc.url)}" target="_blank" rel="noopener">\${escHtml(tc.title)}</a></div>\`;
            }
            storyBlock.appendChild(tcs);
          }
          body.appendChild(storyBlock);
        }
        if (node.orphans.length) {
          const orph = el('div', { class: 'trace-story' });
          orph.innerHTML = \`<div class="trace-story-head"><span class="trace-story-id">?</span><span class="trace-story-label" style="color:var(--warning)">Unmapped test cases under \${epicId}</span><span class="trace-story-count">\${node.orphans.length}</span></div>\`;
          const tcs = el('div', { class: 'trace-tcs' });
          for (const tc of node.orphans) {
            tcs.innerHTML += \`<div class="trace-tc"><span class="trace-tc-num">#\${tc.number}</span>\${statusPill(tc.status)}<a href="\${escHtml(tc.url)}" target="_blank" rel="noopener">\${escHtml(tc.title)}</a></div>\`;
          }
          orph.appendChild(tcs);
          body.appendChild(orph);
        }
      }

      epicCard.querySelector('.trace-epic-head').addEventListener('click', () => epicCard.classList.toggle('open'));
      view.appendChild(epicCard);
    }

    // Coverage heatmap
    const sections = CFG.websiteSections;
    const types = CFG.testingTypes;
    const matrix = {};
    for (const sec of sections) { matrix[sec] = {}; for (const t of types) matrix[sec][t] = 0; }
    for (const r of ROWS) {
      if (r.section && r.testingType && matrix[r.section]) {
        matrix[r.section][r.testingType] = (matrix[r.section][r.testingType] || 0) + 1;
      }
    }
    const maxVal = Math.max(1, ...Object.values(matrix).flatMap(row => Object.values(row)));

    const heatCard = el('div', { class: 'card', style: 'margin-top: 22px' });
    heatCard.innerHTML = \`
      <div class="card-header">
        <div class="card-title">Coverage matrix — Section × Testing Type</div>
        <div class="card-sub">Empty cells reveal gaps</div>
      </div>
      <div class="heatmap-wrap">
        <table class="heatmap">
          <thead><tr><th></th>\${types.map(t => '<th>' + escHtml(t) + '</th>').join('')}</tr></thead>
          <tbody>\${sections.map(sec => \`<tr><td class="heat-row-lbl">\${escHtml(sec)}</td>\${types.map(t => {
            const c = matrix[sec][t];
            const intensity = c / maxVal;
            const bg = c > 0 ? \`rgba(76,154,255,\${0.12 + intensity * 0.55})\` : 'transparent';
            return '<td class="heat-cell" data-count="' + c + '" style="background:' + bg + '" title="' + escHtml(sec) + ' × ' + escHtml(t) + ': ' + c + '">' + (c || '·') + '</td>';
          }).join('')}</tr>\`).join('')}</tbody>
        </table>
      </div>\`;
    view.appendChild(heatCard);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // View: ASSIGNEES
  // ══════════════════════════════════════════════════════════════════════════
  function renderAssignees() {
    const view = document.getElementById('view');
    const total = ROWS.length;

    // Aggregate
    const map = {};
    let unassigned = 0;
    for (const r of ROWS) {
      if (r.assignees.length === 0) { unassigned++; continue; }
      for (const a of r.assignees) {
        if (!map[a.login]) { map[a.login] = { login: a.login, avatar: a.avatar, count: 0, statusCounts: {} }; for (const s of CFG.executionStatuses) map[a.login].statusCounts[s] = 0; }
        map[a.login].count++;
        map[a.login].statusCounts[r.status] = (map[a.login].statusCounts[r.status] || 0) + 1;
      }
    }
    const list = Object.values(map).sort((a,b) => b.count - a.count);

    view.appendChild(el('div', { class: 'view-header' },
      el('div', null,
        el('div', { class: 'view-title' }, 'Assignees'),
        el('div', { class: 'view-sub' }, \`\${list.length} contributor\${list.length === 1 ? '' : 's'} with assignments · \${unassigned} unassigned test case\${unassigned === 1 ? '' : 's'}\`)
      )
    ));

    const topWrap = el('div', { class: 'assignee-top' });

    const chartCard = el('div', { class: 'card' });
    chartCard.innerHTML = \`
      <div class="card-header"><div class="card-title">Workload distribution</div><div class="card-sub">assigned test cases</div></div>
      <div style="height: \${Math.max(220, Math.min(list.length, 10) * 32)}px; position: relative;"><canvas id="chart-assignees"></canvas></div>\`;
    topWrap.appendChild(chartCard);

    const kpiStack = el('div', null);
    const unassignedPct = total ? Math.round((unassigned / total) * 100) : 0;
    const avgLoad = list.length ? Math.round((list.reduce((s,a) => s + a.count, 0) / list.length) * 10) / 10 : 0;
    kpiStack.innerHTML = \`
      <div class="kpi-grid" style="grid-template-columns: 1fr; margin-bottom: 14px;">
        <div class="kpi"><div class="kpi-top"><span>Contributors</span><span class="kpi-icon" style="background:#4c9aff22;color:#4c9aff">👥</span></div><div class="kpi-value">\${list.length}</div></div>
        <div class="kpi"><div class="kpi-top"><span>Unassigned</span><span class="kpi-icon" style="background:#ff563022;color:#ff5630">⚠</span></div><div class="kpi-value">\${unassigned}</div><div class="kpi-foot">\${unassignedPct}% of total</div></div>
        <div class="kpi"><div class="kpi-top"><span>Avg per assignee</span><span class="kpi-icon" style="background:#6554c022;color:#6554c0">Σ</span></div><div class="kpi-value">\${avgLoad}</div></div>
      </div>\`;
    topWrap.appendChild(kpiStack);
    view.appendChild(topWrap);

    // Leaderboard list
    const listCard = el('div', { class: 'assignee-list' });
    list.forEach((a, i) => {
      const pct = total ? (a.count / total) * 100 : 0;
      const segs = CFG.executionStatuses.map(s => {
        const c = a.statusCounts[s];
        if (!c) return '';
        return \`<div class="assignee-bar-seg" style="flex:\${c};background:\${STATUS_COLORS[s]}" title="\${s}: \${c}"></div>\`;
      }).join('');
      const row = el('div', { class: 'assignee-row' });
      row.innerHTML = \`
        <div class="assignee-rank">#\${i+1}</div>
        <div class="assignee-info">
          <img class="avatar avatar-lg" src="\${escHtml(a.avatar)}&s=64" alt="\${escHtml(a.login)}">
          <div>
            <div class="assignee-name">\${escHtml(a.login)}</div>
            <div class="assignee-sub">\${a.count} test case\${a.count === 1 ? '' : 's'} assigned</div>
          </div>
        </div>
        <div><span class="assignee-percent">\${pct.toFixed(1)}%</span><span class="assignee-percent-sub">of \${total}</span></div>
        <div class="assignee-bar">\${segs}</div>\`;
      row.addEventListener('click', () => {
        location.hash = '#/test-cases?assignee=' + encodeURIComponent(a.login);
      });
      listCard.appendChild(row);
    });

    if (unassigned > 0) {
      const row = el('div', { class: 'assignee-row assignee-unassigned' });
      row.innerHTML = \`
        <div class="assignee-rank">—</div>
        <div class="assignee-info">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--bg-input);display:grid;place-items:center;color:var(--danger);font-weight:700;border:2px solid var(--bg-surface)">?</div>
          <div>
            <div class="assignee-name">Unassigned</div>
            <div class="assignee-sub">test cases without an assignee</div>
          </div>
        </div>
        <div><span class="assignee-percent">\${unassignedPct}%</span><span class="assignee-percent-sub">of \${total}</span></div>
        <div class="assignee-bar"><div class="assignee-bar-seg" style="flex:1;background:var(--danger)"></div></div>\`;
      listCard.appendChild(row);
    }

    if (list.length === 0 && unassigned === 0) {
      listCard.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div>No test cases yet.</div>';
    }
    view.appendChild(listCard);

    // Horizontal bar chart
    queueMicrotask(() => {
      if (list.length === 0) return;
      const top = list.slice(0, 10);
      charts.push(new Chart(document.getElementById('chart-assignees'), {
        type: 'bar',
        data: {
          labels: top.map(a => a.login),
          datasets: [{
            label: 'Assigned',
            data: top.map(a => a.count),
            backgroundColor: top.map((_, i) => PALETTE[i % PALETTE.length]),
            borderWidth: 0,
            borderRadius: 3,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          indexAxis: 'y',
          scales: {
            x: { beginAtZero: true, grid: { color: getCss('--border') }, ticks: { color: getCss('--text-muted'), precision: 0 } },
            y: { grid: { display: false }, ticks: { color: getCss('--text-muted'), font: { weight: 600 } } },
          },
          plugins: { legend: { display: false }, tooltip: tooltipStyle() },
        },
      }));
    });
  }

  // ── Chart helpers ──────────────────────────────────────────────────────────
  function getCss(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function tooltipStyle() {
    return {
      backgroundColor: 'rgba(9, 30, 66, 0.95)',
      titleColor: '#fff',
      bodyColor: '#e6ebf5',
      titleFont: { family: "'Inter', sans-serif", weight: 600, size: 12 },
      bodyFont: { family: "'Inter', sans-serif", size: 12 },
      cornerRadius: 6,
      padding: 10,
      boxPadding: 4,
      displayColors: true,
    };
  }
})();
`;

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
<style>body{font-family:'Inter',system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b1220;color:#8a96ac}a{color:#4c9aff}</style>
</head>
<body><p>Redirecting to the <a href="index.html">Criterium dashboard</a>…</p></body>
</html>`;
writeFileSync(resolve(outDir, "test-matrix.html"), redirect, "utf8");

console.log(`✓ docs/test-matrix.json (${rows.length} rows)`);
console.log(`✓ docs/test-matrix.csv  (${rows.length} rows, enriched, BOM)`);
console.log(`✓ docs/index.html       (Criterium SPA)`);
console.log(`✓ docs/test-matrix.html (redirect)`);
