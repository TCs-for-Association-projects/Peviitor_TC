#!/usr/bin/env node
/**
 * generate-matrix.js
 * Fetches all Test_Case-labeled issues and writes:
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

  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    state: issue.state,
    epic: epic ? epic.id : "",
    epicLabel: epic ? epic.label : "",
    userStory: us ? us.id : "",
    userStoryLabel: us ? us.label : "",
    testingType: isNoResponse(f["Testing Type"]) ? "" : f["Testing Type"].trim(),
    section: isNoResponse(f["Website Section"]) ? "" : f["Website Section"].trim(),
    environment: isNoResponse(f["Test Environment"]) ? "" : f["Test Environment"].trim(),
    os: isNoResponse(f["Operating System"]) ? "" : f["Operating System"].trim(),
    browser: isNoResponse(f["Browser"]) ? "" : f["Browser"].trim(),
    status: isNoResponse(f["Test Execution Status"]) ? "Not run" : f["Test Execution Status"].trim(),
    bugFound: isChecked(f["Bug Discovery Acknowledgement"]),
    relatedBug: isNoResponse(f["Related Bug Issue"]) ? "" : f["Related Bug Issue"].trim(),
    crossOs: isChecked(f["Cross-OS"]),
    crossBrowser: isChecked(f["Cross-Browser"]),
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
    "number", "title", "url", "state",
    "epic", "userStory", "testingType", "section",
    "environment", "os", "browser", "status",
    "bugFound", "relatedBug", "crossOs", "crossBrowser",
    "createdAt", "updatedAt",
  ];
  const header = cols.join(",");
  const body = rows
    .map((r) => cols.map((c) => csvEscape(r[c])).join(","))
    .join("\n");
  return header + "\n" + body + "\n";
}

// ── HTML output ──────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  "Not run": "#9ca3af",
  Passed: "#16a34a",
  Failed: "#dc2626",
  Blocked: "#eab308",
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
  const stats = {
    total: rows.length,
    byStatus: {},
  };
  for (const s of config.executionStatuses) stats.byStatus[s] = 0;
  for (const r of rows) stats.byStatus[r.status] = (stats.byStatus[r.status] || 0) + 1;

  const statCards = Object.entries(stats.byStatus)
    .map(
      ([status, count]) => `
      <div class="stat" style="border-left: 4px solid ${STATUS_COLORS[status] || "#9ca3af"}">
        <div class="stat-count">${count}</div>
        <div class="stat-label">${htmlEscape(status)}</div>
      </div>`
    )
    .join("");

  const tableRows = rows
    .map((r) => {
      const color = STATUS_COLORS[r.status] || "#9ca3af";
      return `
      <tr data-epic="${htmlEscape(r.epic)}" data-story="${htmlEscape(r.userStory)}"
          data-status="${htmlEscape(r.status)}" data-section="${htmlEscape(r.section)}"
          data-env="${htmlEscape(r.environment)}" data-type="${htmlEscape(r.testingType)}">
        <td><a href="${htmlEscape(r.url)}" target="_blank">#${r.number}</a></td>
        <td class="title">${htmlEscape(r.title)}</td>
        <td>${htmlEscape(r.epic)}</td>
        <td>${htmlEscape(r.userStory)}</td>
        <td>${htmlEscape(r.testingType)}</td>
        <td>${htmlEscape(r.section)}</td>
        <td>${htmlEscape(r.environment)}</td>
        <td>${htmlEscape(r.browser)}</td>
        <td><span class="status-pill" style="background:${color}">${htmlEscape(r.status)}</span></td>
        <td>${r.bugFound ? "🐛" : ""}</td>
      </tr>`;
    })
    .join("");

  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
  const filterOptions = (rows) => ({
    epic: uniq(rows.map((r) => r.epic)),
    story: uniq(rows.map((r) => r.userStory)),
    status: uniq(rows.map((r) => r.status)),
    section: uniq(rows.map((r) => r.section)),
    env: uniq(rows.map((r) => r.environment)),
    type: uniq(rows.map((r) => r.testingType)),
  });
  const opts = filterOptions(rows);
  const optionsHtml = (arr) =>
    arr.map((v) => `<option value="${htmlEscape(v)}">${htmlEscape(v)}</option>`).join("");

  const generatedAt = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Peviitor_TC — Test Matrix</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         margin: 0; padding: 20px; background: #f9fafb; color: #111; }
  h1 { margin: 0 0 4px; }
  .subtitle { color: #6b7280; font-size: 14px; margin-bottom: 20px; }
  .stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
  .stat { background: white; padding: 12px 16px; border-radius: 6px; min-width: 120px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
  .stat-count { font-size: 24px; font-weight: 600; }
  .stat-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;
             background: white; padding: 12px; border-radius: 6px;
             box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
  .filters select, .filters input {
    padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px;
    font-size: 14px; background: white; }
  .filters input { flex: 1; min-width: 200px; }
  table { width: 100%; border-collapse: collapse; background: white;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05); border-radius: 6px; overflow: hidden; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;
           font-size: 14px; }
  th { background: #f3f4f6; cursor: pointer; user-select: none; font-weight: 600;
       position: sticky; top: 0; }
  th:hover { background: #e5e7eb; }
  th::after { content: " ↕"; opacity: 0.3; font-size: 11px; }
  th.sorted-asc::after  { content: " ↑"; opacity: 1; }
  th.sorted-desc::after { content: " ↓"; opacity: 1; }
  tr.hidden { display: none; }
  td.title { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .status-pill { color: white; padding: 2px 10px; border-radius: 12px;
                 font-size: 12px; font-weight: 500; display: inline-block; }
  .footer { margin-top: 20px; font-size: 12px; color: #6b7280; text-align: center; }
</style>
</head>
<body>
<h1>Peviitor_TC — Test Matrix</h1>
<div class="subtitle">Repository: ${htmlEscape(repo)} · Generated: ${generatedAt}</div>

<div class="stats">
  <div class="stat" style="border-left: 4px solid #2563eb">
    <div class="stat-count">${stats.total}</div>
    <div class="stat-label">Total</div>
  </div>
  ${statCards}
</div>

<div class="filters">
  <input type="text" id="search" placeholder="Search title / number...">
  <select id="f-epic"><option value="">All Epics</option>${optionsHtml(opts.epic)}</select>
  <select id="f-story"><option value="">All User Stories</option>${optionsHtml(opts.story)}</select>
  <select id="f-status"><option value="">All Statuses</option>${optionsHtml(opts.status)}</select>
  <select id="f-section"><option value="">All Sections</option>${optionsHtml(opts.section)}</select>
  <select id="f-env"><option value="">All Environments</option>${optionsHtml(opts.env)}</select>
  <select id="f-type"><option value="">All Testing Types</option>${optionsHtml(opts.type)}</select>
</div>

<table id="matrix">
  <thead>
    <tr>
      <th data-col="number" data-type="num">#</th>
      <th data-col="title">Title</th>
      <th data-col="epic">Epic</th>
      <th data-col="story">User Story</th>
      <th data-col="type">Testing Type</th>
      <th data-col="section">Section</th>
      <th data-col="env">Env</th>
      <th data-col="browser">Browser</th>
      <th data-col="status">Status</th>
      <th data-col="bug">Bug</th>
    </tr>
  </thead>
  <tbody>${tableRows}
  </tbody>
</table>

<div class="footer">
  <a href="test-matrix.csv" download>⬇ Download CSV</a>
</div>

<script>
(function () {
  const search = document.getElementById('search');
  const selects = ['epic', 'story', 'status', 'section', 'env', 'type']
    .map(id => ({ id, el: document.getElementById('f-' + id) }));
  const rows = Array.from(document.querySelectorAll('#matrix tbody tr'));

  function applyFilters() {
    const q = search.value.toLowerCase();
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
    }
  }
  search.addEventListener('input', applyFilters);
  for (const { el } of selects) el.addEventListener('change', applyFilters);

  // Column sort
  const ths = document.querySelectorAll('#matrix thead th');
  ths.forEach((th, idx) => {
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
</script>
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
writeFileSync(resolve(outDir, "test-matrix.csv"), toCsv(rows), "utf8");
writeFileSync(resolve(outDir, "test-matrix.html"), toHtml(rows), "utf8");

console.log(`✓ docs/test-matrix.csv  (${rows.length} rows)`);
console.log(`✓ docs/test-matrix.html`);
