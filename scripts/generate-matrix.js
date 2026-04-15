#!/usr/bin/env node
/**
 * generate-matrix.js
 * Fetches all Test_Case-labeled issues and writes:
 *   docs/test-matrix.json
 *   docs/test-matrix.csv
 *   docs/test-matrix.html
 *
 * Env vars:
 *   GITHUB_TOKEN       — token with issues: read
 *   GITHUB_REPOSITORY  — "owner/repo"
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
  // Support local testing with mock data
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
    // Filter out PRs (REST API returns them under /issues too)
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
const isChecked = (v) => /- \[x\]/i.test(v || "");

// ── Build row per issue ──────────────────────────────────────────────────────
function buildRow(issue) {
  const f = parseBody(issue.body);

  const epicValue = f["Epic"] || "";
  const epic = config.epics.find((e) => epicValue.includes(`(#${e.issue})`));
  const usValue = f["User Story"] || "";
  const us = config.userStories.find((u) => usValue.includes(`(#${u.issue})`));

  // Detect status from labels (set by test-execution.js)
  let status = "Not run";
  for (const label of (issue.labels || [])) {
    if (label.name.startsWith("status: ")) {
      status = label.name.slice(8);
      break;
    }
  }

  // Detect bug-found from labels
  const bugFound = (issue.labels || []).some((l) => l.name === "bug-found");

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
    status,
    bugFound,
    crossOs: (issue.labels || []).some((l) => l.name === "cross-os"),
    crossBrowser: (issue.labels || []).some((l) => l.name === "cross-browser"),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
  };
}

// ── CSV output ───────────────────────────────────────────────────────────────
function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const cols = [
    "number", "title", "url", "state", "author",
    "epic", "userStory", "testingType", "section",
    "environment", "os", "browser", "status",
    "bugFound", "crossOs", "crossBrowser",
    "createdAt", "updatedAt",
  ];
  const header = cols.join(",");
  const body = rows
    .map((r) => cols.map((c) => csvEscape(r[c])).join(","))
    .join("\n");
  return header + "\n" + body + "\n";
}

// ── HTML Dashboard ───────────────────────────────────────────────────────────
const STATUS_COLORS = {
  "Not run": "#6b7280",
  "Passed": "#10b981",
  "Failed": "#ef4444",
  "Blocked": "#f59e0b",
  "Partially passed": "#f97316",
};

function htmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toHtml(rows) {
  // ── Compute statistics ───────────────────────────────────────────────────
  const stats = { total: rows.length, byStatus: {}, bugCount: 0 };
  for (const s of config.executionStatuses) stats.byStatus[s] = 0;
  for (const r of rows) {
    stats.byStatus[r.status] = (stats.byStatus[r.status] || 0) + 1;
    if (r.bugFound) stats.bugCount++;
  }

  // Per-epic breakdown
  const epicStats = {};
  for (const r of rows) {
    if (!r.epic) continue;
    if (!epicStats[r.epic]) {
      epicStats[r.epic] = { label: r.epicLabel, total: 0 };
      for (const s of config.executionStatuses) epicStats[r.epic][s] = 0;
    }
    epicStats[r.epic].total++;
    epicStats[r.epic][r.status] = (epicStats[r.epic][r.status] || 0) + 1;
  }

  // Coverage matrix: section × testingType
  const sections = config.websiteSections;
  const types = config.testingTypes;
  const coverageMatrix = {};
  for (const sec of sections) {
    coverageMatrix[sec] = {};
    for (const t of types) coverageMatrix[sec][t] = 0;
  }
  for (const r of rows) {
    if (r.section && r.testingType && coverageMatrix[r.section]) {
      coverageMatrix[r.section][r.testingType] = (coverageMatrix[r.section][r.testingType] || 0) + 1;
    }
  }

  // Filter options
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
  const opts = {
    epic: uniq(rows.map((r) => r.epic)),
    story: uniq(rows.map((r) => r.userStory)),
    status: uniq(rows.map((r) => r.status)),
    section: uniq(rows.map((r) => r.section)),
    env: uniq(rows.map((r) => r.environment)),
    type: uniq(rows.map((r) => r.testingType)),
    author: uniq(rows.map((r) => r.author)),
  };
  const optionsHtml = (arr) =>
    arr.map((v) => `<option value="${htmlEscape(v)}">${htmlEscape(v)}</option>`).join("");

  const generatedAt = new Date().toISOString();

  // ── Table rows ─────────────────────────────────────────────────────────────
  const tableRows = rows.map((r) => {
    const color = STATUS_COLORS[r.status] || "#6b7280";
    const assigneeHtml = r.assignees.length
      ? r.assignees.map((a) =>
          `<img src="${htmlEscape(a.avatar)}&s=20" alt="${htmlEscape(a.login)}" title="${htmlEscape(a.login)}" class="avatar">`
        ).join(" ")
      : '<span class="muted">—</span>';
    const authorHtml = r.author
      ? `<img src="${htmlEscape(r.authorAvatar)}&s=20" alt="${htmlEscape(r.author)}" title="${htmlEscape(r.author)}" class="avatar"> <span class="author-name">${htmlEscape(r.author)}</span>`
      : "";

    return `
      <tr data-epic="${htmlEscape(r.epic)}" data-story="${htmlEscape(r.userStory)}"
          data-status="${htmlEscape(r.status)}" data-section="${htmlEscape(r.section)}"
          data-env="${htmlEscape(r.environment)}" data-type="${htmlEscape(r.testingType)}"
          data-author="${htmlEscape(r.author)}">
        <td><a href="${htmlEscape(r.url)}" target="_blank" rel="noopener">#${r.number}</a></td>
        <td class="cell-title">${htmlEscape(r.title)}</td>
        <td>${htmlEscape(r.epic)}</td>
        <td>${htmlEscape(r.userStory)}</td>
        <td>${htmlEscape(r.testingType)}</td>
        <td>${htmlEscape(r.section)}</td>
        <td>${htmlEscape(r.environment)}</td>
        <td><span class="status-pill" style="background:${color}">${htmlEscape(r.status)}</span></td>
        <td>${r.bugFound ? "🐛" : ""}</td>
        <td>${authorHtml}</td>
        <td>${assigneeHtml}</td>
        <td class="cell-date">${new Date(r.createdAt).toLocaleDateString("en-GB")}</td>
      </tr>`;
  }).join("");

  // ── Coverage heatmap rows ──────────────────────────────────────────────────
  const maxCoverage = Math.max(1, ...Object.values(coverageMatrix).flatMap((row) => Object.values(row)));
  const coverageRows = sections.map((sec) => {
    const cells = types.map((t) => {
      const count = coverageMatrix[sec][t];
      const intensity = count / maxCoverage;
      const bg = count > 0
        ? `rgba(59, 130, 246, ${0.15 + intensity * 0.7})`
        : "transparent";
      return `<td class="heat-cell" style="background:${bg}">${count || ""}</td>`;
    }).join("");
    return `<tr><td class="heat-label">${htmlEscape(sec)}</td>${cells}</tr>`;
  }).join("");

  // ── Chart data JSON ────────────────────────────────────────────────────────
  const chartData = {
    statusLabels: config.executionStatuses,
    statusCounts: config.executionStatuses.map((s) => stats.byStatus[s] || 0),
    statusColors: config.executionStatuses.map((s) => STATUS_COLORS[s] || "#6b7280"),
    epicLabels: Object.keys(epicStats),
    epicDatasets: config.executionStatuses.map((s) => ({
      label: s,
      data: Object.keys(epicStats).map((e) => epicStats[e][s] || 0),
      backgroundColor: STATUS_COLORS[s] || "#6b7280",
    })),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Peviitor_TC — Test Dashboard</title>
<meta name="description" content="QA Test Case Dashboard for peviitor.ro — execution status, coverage, traceability.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>
<style>
  /* ── Theme tokens ─────────────────────────────────────────────────────────── */
  :root {
    --bg-body: #0f172a;
    --bg-card: #1e293b;
    --bg-card-hover: #263548;
    --bg-input: #334155;
    --border: #334155;
    --text: #e2e8f0;
    --text-muted: #94a3b8;
    --text-heading: #f1f5f9;
    --accent: #3b82f6;
    --accent-dim: rgba(59,130,246,0.15);
    --radius: 12px;
    --radius-sm: 8px;
    --shadow: 0 4px 24px rgba(0,0,0,0.25);
    --shadow-sm: 0 1px 4px rgba(0,0,0,0.15);
    --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --transition: 0.2s ease;
  }
  [data-theme="light"] {
    --bg-body: #f1f5f9;
    --bg-card: #ffffff;
    --bg-card-hover: #f8fafc;
    --bg-input: #f1f5f9;
    --border: #e2e8f0;
    --text: #1e293b;
    --text-muted: #64748b;
    --text-heading: #0f172a;
    --shadow: 0 4px 24px rgba(0,0,0,0.08);
    --shadow-sm: 0 1px 4px rgba(0,0,0,0.06);
  }

  /* ── Reset & base ─────────────────────────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font);
    background: var(--bg-body);
    color: var(--text);
    line-height: 1.5;
    min-height: 100vh;
    transition: background var(--transition), color var(--transition);
  }

  /* ── Layout ───────────────────────────────────────────────────────────────── */
  .dashboard {
    max-width: 1440px;
    margin: 0 auto;
    padding: 24px 28px;
  }

  /* ── Header ───────────────────────────────────────────────────────────────── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 28px;
  }
  .header h1 {
    font-size: 26px;
    font-weight: 700;
    color: var(--text-heading);
    letter-spacing: -0.5px;
  }
  .header h1 span { color: var(--accent); }
  .header-meta {
    font-size: 13px;
    color: var(--text-muted);
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* ── Theme toggle ─────────────────────────────────────────────────────────── */
  .theme-toggle {
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 7px 14px;
    font-size: 13px;
    font-family: var(--font);
    cursor: pointer;
    transition: all var(--transition);
  }
  .theme-toggle:hover { border-color: var(--accent); }

  /* ── KPI Cards ────────────────────────────────────────────────────────────── */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
    margin-bottom: 28px;
  }
  .kpi-card {
    background: var(--bg-card);
    border-radius: var(--radius);
    padding: 18px 20px;
    border-left: 4px solid var(--accent);
    box-shadow: var(--shadow-sm);
    transition: transform var(--transition), box-shadow var(--transition), background var(--transition);
  }
  .kpi-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow);
    background: var(--bg-card-hover);
  }
  .kpi-value {
    font-size: 32px;
    font-weight: 700;
    color: var(--text-heading);
    line-height: 1.1;
  }
  .kpi-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 4px;
  }

  /* ── Charts section ───────────────────────────────────────────────────────── */
  .charts-row {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 20px;
    margin-bottom: 28px;
  }
  @media (max-width: 900px) {
    .charts-row { grid-template-columns: 1fr; }
  }
  .chart-card {
    background: var(--bg-card);
    border-radius: var(--radius);
    padding: 24px;
    box-shadow: var(--shadow-sm);
    transition: background var(--transition);
  }
  .chart-card h2 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-heading);
    margin-bottom: 16px;
  }
  .chart-container {
    position: relative;
    width: 100%;
  }
  .chart-container.doughnut { max-width: 280px; margin: 0 auto; }

  /* ── Coverage heatmap ─────────────────────────────────────────────────────── */
  .heatmap-card {
    background: var(--bg-card);
    border-radius: var(--radius);
    padding: 24px;
    box-shadow: var(--shadow-sm);
    margin-bottom: 28px;
    overflow-x: auto;
    transition: background var(--transition);
  }
  .heatmap-card h2 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-heading);
    margin-bottom: 16px;
  }
  .heatmap { border-collapse: collapse; width: 100%; min-width: 600px; }
  .heatmap th {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 8px 10px;
    text-align: center;
    border-bottom: 1px solid var(--border);
  }
  .heat-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    padding: 8px 12px;
    text-align: left;
    white-space: nowrap;
  }
  .heat-cell {
    text-align: center;
    padding: 8px 10px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    min-width: 60px;
    transition: background var(--transition);
  }

  /* ── Filters ──────────────────────────────────────────────────────────────── */
  .filters-bar {
    background: var(--bg-card);
    border-radius: var(--radius);
    padding: 16px 20px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 20px;
    box-shadow: var(--shadow-sm);
    transition: background var(--transition);
  }
  .filters-bar select, .filters-bar input[type="text"] {
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-input);
    color: var(--text);
    font-size: 13px;
    font-family: var(--font);
    transition: border-color var(--transition), background var(--transition);
    outline: none;
  }
  .filters-bar select:focus, .filters-bar input:focus {
    border-color: var(--accent);
  }
  .filters-bar input[type="text"] {
    flex: 1;
    min-width: 200px;
  }
  .filter-count {
    font-size: 13px;
    color: var(--text-muted);
    margin-left: auto;
  }

  /* ── Data table ───────────────────────────────────────────────────────────── */
  .table-card {
    background: var(--bg-card);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    transition: background var(--transition);
  }
  .table-wrap { overflow-x: auto; }
  table.data {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  table.data th {
    background: var(--bg-input);
    color: var(--text-muted);
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 12px 14px;
    text-align: left;
    cursor: pointer;
    user-select: none;
    position: sticky;
    top: 0;
    border-bottom: 2px solid var(--border);
    white-space: nowrap;
    transition: background var(--transition), color var(--transition);
  }
  table.data th:hover { color: var(--accent); }
  table.data th::after { content: " ↕"; opacity: 0.3; font-size: 10px; }
  table.data th.sorted-asc::after  { content: " ↑"; opacity: 1; color: var(--accent); }
  table.data th.sorted-desc::after { content: " ↓"; opacity: 1; color: var(--accent); }
  table.data td {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    vertical-align: middle;
    transition: background var(--transition);
  }
  table.data tbody tr:hover td {
    background: var(--accent-dim);
  }
  table.data tr.hidden { display: none; }
  .cell-title {
    max-width: 350px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cell-date { white-space: nowrap; color: var(--text-muted); font-size: 12px; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* ── Status pill ──────────────────────────────────────────────────────────── */
  .status-pill {
    color: #fff;
    padding: 3px 12px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
    display: inline-block;
    white-space: nowrap;
  }

  /* ── Avatars ──────────────────────────────────────────────────────────────── */
  .avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    vertical-align: middle;
    border: 1.5px solid var(--border);
    transition: transform var(--transition);
  }
  .avatar:hover { transform: scale(1.2); }
  .author-name {
    font-size: 12px;
    color: var(--text-muted);
    vertical-align: middle;
    margin-left: 4px;
  }
  .muted { color: var(--text-muted); }

  /* ── Footer ───────────────────────────────────────────────────────────────── */
  .page-footer {
    text-align: center;
    padding: 28px 0 16px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .page-footer a { color: var(--accent); }
  .page-footer .sep { margin: 0 8px; }

  /* ── Responsive ───────────────────────────────────────────────────────────── */
  @media (max-width: 640px) {
    .dashboard { padding: 16px; }
    .kpi-grid { grid-template-columns: repeat(2, 1fr); }
    .header h1 { font-size: 20px; }
    .kpi-value { font-size: 24px; }
  }
</style>
</head>
<body>
<div class="dashboard">

  <!-- ── Header ────────────────────────────────────────────────────────────── -->
  <header class="header">
    <div>
      <h1><span>Peviitor_TC</span> — Test Dashboard</h1>
      <div class="header-meta">
        ${htmlEscape(repo)} · Generated ${new Date(generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC
      </div>
    </div>
    <div class="header-actions">
      <button class="theme-toggle" onclick="toggleTheme()" title="Switch theme">🌙 Dark</button>
    </div>
  </header>

  <!-- ── KPI Cards ─────────────────────────────────────────────────────────── -->
  <div class="kpi-grid">
    <div class="kpi-card" style="border-left-color: #3b82f6">
      <div class="kpi-value">${stats.total}</div>
      <div class="kpi-label">Total Test Cases</div>
    </div>
    <div class="kpi-card" style="border-left-color: ${STATUS_COLORS["Passed"]}">
      <div class="kpi-value">${stats.byStatus["Passed"] || 0}</div>
      <div class="kpi-label">Passed</div>
    </div>
    <div class="kpi-card" style="border-left-color: ${STATUS_COLORS["Failed"]}">
      <div class="kpi-value">${stats.byStatus["Failed"] || 0}</div>
      <div class="kpi-label">Failed</div>
    </div>
    <div class="kpi-card" style="border-left-color: ${STATUS_COLORS["Blocked"]}">
      <div class="kpi-value">${stats.byStatus["Blocked"] || 0}</div>
      <div class="kpi-label">Blocked</div>
    </div>
    <div class="kpi-card" style="border-left-color: ${STATUS_COLORS["Not run"]}">
      <div class="kpi-value">${stats.byStatus["Not run"] || 0}</div>
      <div class="kpi-label">Not Run</div>
    </div>
    <div class="kpi-card" style="border-left-color: #ef4444">
      <div class="kpi-value">${stats.bugCount}</div>
      <div class="kpi-label">Bugs Found</div>
    </div>
  </div>

  <!-- ── Charts ────────────────────────────────────────────────────────────── -->
  <div class="charts-row">
    <div class="chart-card">
      <h2>📊 Status Distribution</h2>
      <div class="chart-container doughnut">
        <canvas id="statusChart"></canvas>
      </div>
    </div>
    <div class="chart-card">
      <h2>📈 Test Cases by Epic</h2>
      <div class="chart-container">
        <canvas id="epicChart"></canvas>
      </div>
    </div>
  </div>

  <!-- ── Coverage Heatmap ──────────────────────────────────────────────────── -->
  <div class="heatmap-card">
    <h2>🗺️ Coverage Matrix — Section × Testing Type</h2>
    <table class="heatmap">
      <thead>
        <tr>
          <th></th>
          ${types.map((t) => `<th>${htmlEscape(t)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${coverageRows}
      </tbody>
    </table>
  </div>

  <!-- ── Filters ───────────────────────────────────────────────────────────── -->
  <div class="filters-bar">
    <input type="text" id="search" placeholder="🔍 Search title or #number...">
    <select id="f-epic"><option value="">All Epics</option>${optionsHtml(opts.epic)}</select>
    <select id="f-story"><option value="">All Stories</option>${optionsHtml(opts.story)}</select>
    <select id="f-status"><option value="">All Statuses</option>${optionsHtml(opts.status)}</select>
    <select id="f-section"><option value="">All Sections</option>${optionsHtml(opts.section)}</select>
    <select id="f-env"><option value="">All Environments</option>${optionsHtml(opts.env)}</select>
    <select id="f-type"><option value="">All Types</option>${optionsHtml(opts.type)}</select>
    <select id="f-author"><option value="">All Authors</option>${optionsHtml(opts.author)}</select>
    <span class="filter-count" id="row-count">${rows.length} test cases</span>
  </div>

  <!-- ── Data Table ────────────────────────────────────────────────────────── -->
  <div class="table-card">
    <div class="table-wrap">
      <table class="data" id="matrix">
        <thead>
          <tr>
            <th data-col="number" data-type="num">#</th>
            <th data-col="title">Title</th>
            <th data-col="epic">Epic</th>
            <th data-col="story">Story</th>
            <th data-col="type">Type</th>
            <th data-col="section">Section</th>
            <th data-col="env">Env</th>
            <th data-col="status">Status</th>
            <th data-col="bug">Bug</th>
            <th data-col="author">Author</th>
            <th>Assignees</th>
            <th data-col="date">Created</th>
          </tr>
        </thead>
        <tbody>${tableRows}
        </tbody>
      </table>
    </div>
  </div>

  <!-- ── Footer ────────────────────────────────────────────────────────────── -->
  <footer class="page-footer">
    <a href="test-matrix.csv" download>⬇ Download CSV</a>
    <span class="sep">·</span>
    <a href="https://github.com/${htmlEscape(repo)}" target="_blank">GitHub Repository</a>
    <span class="sep">·</span>
    Generated by <strong>generate-matrix.js</strong>
  </footer>

</div>

<script>
// ── Theme toggle ─────────────────────────────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') !== 'light';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('peviitor-theme', isDark ? 'light' : 'dark');
  const btn = document.querySelector('.theme-toggle');
  btn.textContent = isDark ? '☀️ Light' : '🌙 Dark';
  updateChartColors();
}
(function initTheme() {
  const saved = localStorage.getItem('peviitor-theme');
  if (saved === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    document.querySelector('.theme-toggle').textContent = '☀️ Light';
  }
})();

// ── Charts ───────────────────────────────────────────────────────────────────
const chartData = ${JSON.stringify(chartData)};
const getTextColor = () => getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
const getMutedColor = () => getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();
const getGridColor = () => getComputedStyle(document.documentElement).getPropertyValue('--border').trim();

// Doughnut
const statusCtx = document.getElementById('statusChart').getContext('2d');
const statusChart = new Chart(statusCtx, {
  type: 'doughnut',
  data: {
    labels: chartData.statusLabels,
    datasets: [{
      data: chartData.statusCounts,
      backgroundColor: chartData.statusColors,
      borderWidth: 0,
      hoverOffset: 6,
    }],
  },
  options: {
    responsive: true,
    cutout: '65%',
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: getTextColor(),
          padding: 16,
          font: { family: "'Inter', sans-serif", size: 12 },
          usePointStyle: true,
          pointStyleWidth: 10,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        titleFont: { family: "'Inter', sans-serif" },
        bodyFont: { family: "'Inter', sans-serif" },
        cornerRadius: 8,
        padding: 12,
      },
    },
  },
});

// Stacked bar
const epicCtx = document.getElementById('epicChart').getContext('2d');
const epicChart = new Chart(epicCtx, {
  type: 'bar',
  data: {
    labels: chartData.epicLabels,
    datasets: chartData.epicDatasets,
  },
  options: {
    responsive: true,
    scales: {
      x: {
        stacked: true,
        grid: { color: getGridColor() },
        ticks: { color: getMutedColor(), font: { family: "'Inter', sans-serif", size: 11 } },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        grid: { color: getGridColor() },
        ticks: {
          color: getMutedColor(),
          font: { family: "'Inter', sans-serif", size: 11 },
          stepSize: 1,
          precision: 0,
        },
      },
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: getTextColor(),
          padding: 16,
          font: { family: "'Inter', sans-serif", size: 12 },
          usePointStyle: true,
          pointStyleWidth: 10,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        titleFont: { family: "'Inter', sans-serif" },
        bodyFont: { family: "'Inter', sans-serif" },
        cornerRadius: 8,
        padding: 12,
      },
    },
  },
});

function updateChartColors() {
  const txt = getTextColor();
  const muted = getMutedColor();
  const grid = getGridColor();
  statusChart.options.plugins.legend.labels.color = txt;
  statusChart.update();
  epicChart.options.scales.x.grid.color = grid;
  epicChart.options.scales.x.ticks.color = muted;
  epicChart.options.scales.y.grid.color = grid;
  epicChart.options.scales.y.ticks.color = muted;
  epicChart.options.plugins.legend.labels.color = txt;
  epicChart.update();
}

// ── Filters & search ─────────────────────────────────────────────────────────
(function () {
  const search = document.getElementById('search');
  const countEl = document.getElementById('row-count');
  const selects = ['epic', 'story', 'status', 'section', 'env', 'type', 'author']
    .map(id => ({ id, el: document.getElementById('f-' + id) }));
  const rows = Array.from(document.querySelectorAll('#matrix tbody tr'));

  function applyFilters() {
    const q = search.value.toLowerCase();
    let visible = 0;
    for (const row of rows) {
      let show = true;
      for (const { id, el } of selects) {
        const v = el.value;
        if (v && row.dataset[id] !== v) { show = false; break; }
      }
      if (show && q) {
        const txt = row.textContent.toLowerCase();
        if (!txt.includes(q)) show = false;
      }
      row.classList.toggle('hidden', !show);
      if (show) visible++;
    }
    countEl.textContent = visible + ' of ' + rows.length + ' test cases';
  }
  search.addEventListener('input', applyFilters);
  for (const { el } of selects) el.addEventListener('change', applyFilters);

  // Column sort
  const ths = document.querySelectorAll('#matrix thead th');
  ths.forEach((th, idx) => {
    if (!th.dataset.col) return;
    th.addEventListener('click', () => {
      const asc = !th.classList.contains('sorted-asc');
      ths.forEach(t => t.classList.remove('sorted-asc', 'sorted-desc'));
      th.classList.add(asc ? 'sorted-asc' : 'sorted-desc');
      const isNum = th.dataset.type === 'num';
      const tbody = document.querySelector('#matrix tbody');
      const sorted = rows.slice().sort((a, b) => {
        const av = a.children[idx].textContent.trim();
        const bv = b.children[idx].textContent.trim();
        const cmp = isNum
          ? (parseInt(av.replace(/\\D/g,''), 10) || 0) - (parseInt(bv.replace(/\\D/g,''), 10) || 0)
          : av.localeCompare(bv);
        return asc ? cmp : -cmp;
      });
      for (const r of sorted) tbody.appendChild(r);
    });
  });
})();
<\/script>
</body>
</html>
`;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const issues = await fetchAllIssues();
console.log(`Fetched ${issues.length} Test_Case issues.`);

const rows = issues.map(buildRow);

const outDir = resolve(root, "docs");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "test-matrix.json"), JSON.stringify(rows, null, 2), "utf8");
writeFileSync(resolve(outDir, "test-matrix.csv"), toCsv(rows), "utf8");
writeFileSync(resolve(outDir, "test-matrix.html"), toHtml(rows), "utf8");

console.log(`✓ docs/test-matrix.json (${rows.length} rows)`);
console.log(`✓ docs/test-matrix.csv  (${rows.length} rows)`);
console.log(`✓ docs/test-matrix.html`);
