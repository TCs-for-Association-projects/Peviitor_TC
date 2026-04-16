/* ═══════════════════════════════════════════════════════════════════════════
   Peviitor TC Dashboard — SPA Logic
   ═══════════════════════════════════════════════════════════════════════════ */
(() => {
"use strict";

const DATA = JSON.parse(document.getElementById("dashboard-data").textContent);
const { repo, generatedAt, config, rows } = DATA;
const [owner, repoName] = repo.split("/");
const repoUrl = `https://github.com/${repo}`;

// ── Utilities ────────────────────────────────────────────────────────────
const $ = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => [...(p || document).querySelectorAll(s)];
const h = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const statusClass = (s) => ({ Passed:"passed", Failed:"failed", Blocked:"blocked", "Partially passed":"partial", "Not run":"notrun" }[s] || "notrun");
const unique = (arr) => [...new Set(arr)].filter(Boolean).sort();
const relTime = (iso) => {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "1d ago";
  return `${d}d ago`;
};

// ── Status counting ──────────────────────────────────────────────────────
function statusCounts(data) {
  const c = { Passed:0, Failed:0, Blocked:0, "Partially passed":0, "Not run":0 };
  for (const r of data) c[r.status] = (c[r.status] || 0) + 1;
  c.total = data.length;
  c.executed = c.total - c["Not run"];
  c.passRate = c.executed ? Math.round((c.Passed / c.executed) * 100) : 0;
  c.bugs = data.filter(r => r.bugFound).length;
  return c;
}

// ── Theme ────────────────────────────────────────────────────────────────
const html = document.documentElement;
const savedTheme = localStorage.getItem("ptc-theme") || "dark";
html.setAttribute("data-theme", savedTheme);
updateThemeIcons(savedTheme);

$("#theme-toggle").addEventListener("click", () => {
  const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", next);
  localStorage.setItem("ptc-theme", next);
  updateThemeIcons(next);
});

function updateThemeIcons(t) {
  $("#icon-moon").style.display = t === "dark" ? "none" : "";
  $("#icon-sun").style.display  = t === "dark" ? "" : "none";
}

// ── Footer timestamp ─────────────────────────────────────────────────────
if (generatedAt) {
  const d = new Date(generatedAt);
  $("#footer-ts").textContent = d.toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

// ── Global Search ────────────────────────────────────────────────────────
const searchInput = $("#search-input");
const searchResults = $("#search-results");

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== searchInput) { e.preventDefault(); searchInput.focus(); }
  if (e.key === "Escape") { searchInput.blur(); searchResults.hidden = true; }
});

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  if (q.length < 2) { searchResults.hidden = true; return; }
  const hits = rows.filter(r =>
    String(r.number).includes(q) ||
    r.title.toLowerCase().includes(q) ||
    (r.description || "").toLowerCase().includes(q) ||
    r.author.toLowerCase().includes(q)
  ).slice(0, 10);

  if (hits.length === 0) {
    searchResults.innerHTML = `<div class="sr-empty">No matches for "${h(q)}"</div>`;
  } else {
    searchResults.innerHTML = hits.map(r => `
      <div class="sr-item" data-num="${r.number}">
        <div><span class="sr-num">#${r.number}</span><span class="sr-title">${h(r.title)}</span></div>
        <div class="sr-meta"><span class="status-dot ${statusClass(r.status)}"></span> ${h(r.status)} · ${h(r.epic)} · ${h(r.section)}</div>
      </div>
    `).join("");
  }
  searchResults.hidden = false;
});

searchResults.addEventListener("click", (e) => {
  const item = e.target.closest(".sr-item");
  if (!item) return;
  const num = item.dataset.num;
  searchResults.hidden = true;
  searchInput.value = "";
  navigate(`#/tests?search=${num}`);
});

searchInput.addEventListener("blur", () => { setTimeout(() => searchResults.hidden = true, 200); });

// ── Router ───────────────────────────────────────────────────────────────
const routes = { overview: renderOverview, tests: renderTests, coverage: renderCoverage, guide: renderGuide };

function navigate(hash) {
  window.location.hash = hash;
}

function route() {
  const raw = window.location.hash.replace("#/", "") || "overview";
  const [page, qs] = raw.split("?");
  const routeName = page || "overview";
  const params = new URLSearchParams(qs || "");

  // Update tabs
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.route === routeName));
  updateTabIndicator(routeName);

  // Render
  const view = $("#view");
  view.innerHTML = "";
  view.style.animation = "none";
  void view.offsetHeight;
  view.style.animation = "";

  if (routes[routeName]) {
    routes[routeName](view, params);
  } else {
    routes.overview(view, params);
  }
}

function updateTabIndicator(routeName) {
  const tab = $(`.tab[data-route="${routeName}"]`);
  const indicator = $("#tab-indicator");
  if (tab && indicator) {
    const rect = tab.getBoundingClientRect();
    const parent = tab.parentElement.getBoundingClientRect();
    indicator.style.left = (rect.left - parent.left) + "px";
    indicator.style.width = rect.width + "px";
  }
}

window.addEventListener("hashchange", route);
route();

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════
function renderOverview(view) {
  const c = statusCounts(rows);

  view.innerHTML = `
    <div class="section-header">
      <div class="section-title">Overview</div>
      <div class="section-sub">${c.total} test cases · ${c.executed} executed · ${c.passRate}% pass rate</div>
    </div>

    <!-- Metrics -->
    <div class="metrics-strip">
      <div class="metric"><div class="metric-value">${c.total}</div><div class="metric-label">Total</div></div>
      <div class="metric"><div class="metric-value color-passed">${c.Passed}</div><div class="metric-label">Passed</div></div>
      <div class="metric"><div class="metric-value color-failed">${c.Failed}</div><div class="metric-label">Failed</div></div>
      <div class="metric"><div class="metric-value color-blocked">${c.Blocked}</div><div class="metric-label">Blocked</div></div>
      <div class="metric"><div class="metric-value color-partial">${c["Partially passed"]}</div><div class="metric-label">Partial</div></div>
      <div class="metric"><div class="metric-value color-notrun">${c["Not run"]}</div><div class="metric-label">Not Run</div></div>
    </div>

    <!-- Status bar -->
    <div class="status-bar-wrap">
      <div class="status-bar" id="status-bar"></div>
      <div class="status-bar-legend">
        <span><span class="legend-dot" style="background:var(--status-passed)"></span>Passed ${c.Passed}</span>
        <span><span class="legend-dot" style="background:var(--status-failed)"></span>Failed ${c.Failed}</span>
        <span><span class="legend-dot" style="background:var(--status-blocked)"></span>Blocked ${c.Blocked}</span>
        <span><span class="legend-dot" style="background:var(--status-partial)"></span>Partial ${c["Partially passed"]}</span>
        <span><span class="legend-dot" style="background:var(--status-notrun)"></span>Not Run ${c["Not run"]}</span>
        <span><span class="legend-dot" style="background:var(--status-failed)"></span>Bugs ${c.bugs}</span>
      </div>
    </div>

    <!-- Pass rate + Epic health -->
    <div class="overview-grid">
      <div class="card arc-card">
        <div class="card-title">Pass Rate</div>
        <div class="arc-wrap" id="arc-wrap"></div>
      </div>
      <div class="card">
        <div class="card-title">Epic Health</div>
        <table class="health-table">
          <thead><tr><th>Epic</th><th>Tests</th><th>Pass Rate</th><th>Gaps</th></tr></thead>
          <tbody id="epic-health"></tbody>
        </table>
      </div>
    </div>

    <!-- Distribution grid -->
    <div class="dist-grid" id="dist-grid"></div>
  `;

  // Status bar segments
  const bar = $("#status-bar");
  const segs = [
    { cls: "passed", n: c.Passed },
    { cls: "failed", n: c.Failed },
    { cls: "blocked", n: c.Blocked },
    { cls: "partial", n: c["Partially passed"] },
    { cls: "notrun", n: c["Not run"] },
  ];
  bar.innerHTML = segs.filter(s => s.n > 0).map(s =>
    `<div class="status-bar-seg ${s.cls}" style="flex-grow:${s.n}" title="${s.cls}: ${s.n}"></div>`
  ).join("");

  // Pass rate arc
  drawArc(c.passRate);

  // Epic health
  const epicBody = $("#epic-health");
  const epicData = config.epics.map(ep => {
    const tcs = rows.filter(r => r.epic === ep.id);
    const stories = config.userStories.filter(us => us.epicId === ep.id);
    const covered = stories.filter(us => tcs.some(r => r.userStory === us.id));
    const gaps = stories.length - covered.length;
    const passed = tcs.filter(r => r.status === "Passed").length;
    const rate = tcs.length ? Math.round((passed / tcs.length) * 100) : 0;
    return { id: ep.id, label: ep.label, count: tcs.length, rate, gaps };
  }).filter(e => e.count > 0 || e.gaps > 0);

  epicBody.innerHTML = epicData.map(e => `
    <tr data-epic="${e.id}">
      <td><strong>${h(e.id)}</strong> <span style="color:var(--text-secondary)">${h(e.label.replace(/^Epic \w+:\s*/, ""))}</span></td>
      <td style="font-family:'JetBrains Mono',monospace;font-weight:600">${e.count}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="health-bar"><div class="health-bar-fill" style="width:${e.rate}%;background:${e.rate >= 70 ? "var(--status-passed)" : e.rate >= 40 ? "var(--status-blocked)" : "var(--status-failed)"}"></div></div>
          <span style="font-family:'JetBrains Mono',monospace;font-size:11px;width:32px;color:var(--text-secondary)">${e.rate}%</span>
        </div>
      </td>
      <td><span class="gap-badge ${e.gaps > 0 ? "has-gaps" : "no-gaps"}">${e.gaps}</span></td>
    </tr>
  `).join("");

  epicBody.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-epic]");
    if (tr) navigate(`#/tests?epic=${tr.dataset.epic}`);
  });

  // Distribution charts
  const distributions = [
    { title: "By Section", key: "section" },
    { title: "By Type", key: "testingType" },
    { title: "By Environment", key: "environment" },
    { title: "By OS", key: "os" },
    { title: "By Browser", key: "browser" },
    { title: "By Assignee", fn: (r) => r.assignees.length ? r.assignees.map(a => a.login) : ["Unassigned"] },
  ];

  const distGrid = $("#dist-grid");
  for (const d of distributions) {
    const counts = {};
    for (const r of rows) {
      if (d.fn) {
        for (const v of d.fn(r)) counts[v] = (counts[v] || 0) + 1;
      } else {
        const v = r[d.key] || "—";
        counts[v] = (counts[v] || 0) + 1;
      }
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = sorted[0]?.[1] || 1;

    const card = document.createElement("div");
    card.className = "card dist-card";
    card.innerHTML = `<div class="card-title">${d.title}</div>` + sorted.slice(0, 6).map(([label, count]) => `
      <div class="dist-row">
        <span class="dist-label" title="${h(label)}">${h(label)}</span>
        <div class="dist-bar"><div class="dist-bar-fill" style="width:${Math.round(count / max * 100)}%"></div></div>
        <span class="dist-count">${count}</span>
      </div>
    `).join("");
    distGrid.appendChild(card);
  }
}

function drawArc(pct) {
  const wrap = $("#arc-wrap");
  if (!wrap) return;
  const r = 72, cx = 90, cy = 90, sw = 10;
  const circumference = 2 * Math.PI * r;
  const dashLen = (pct / 100) * circumference;
  const color = pct >= 70 ? "var(--status-passed)" : pct >= 40 ? "var(--status-blocked)" : "var(--status-failed)";

  wrap.innerHTML = `
    <svg viewBox="0 0 180 180">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${sw}" />
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"
        stroke-dasharray="${dashLen} ${circumference - dashLen}"
        stroke-dashoffset="${circumference * 0.25}"
        stroke-linecap="round"
        style="transition: stroke-dasharray .6s ease" />
    </svg>
    <div class="arc-center">
      <div class="arc-pct">${pct}%</div>
      <div class="arc-label">pass rate</div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST CASES
// ═══════════════════════════════════════════════════════════════════════════
function renderTests(view, params) {
  const c = statusCounts(rows);

  view.innerHTML = `
    <div class="section-header">
      <div class="section-title">Test Cases</div>
      <div class="section-sub">${c.total} total</div>
    </div>
    <div class="filter-bar" id="filter-bar"></div>
    <div id="test-table-wrap"></div>
  `;

  // Build filters
  const filterBar = $("#filter-bar");
  const filters = {
    search:   { type: "search", placeholder: "Filter by title or #…" },
    epic:     { type: "select", options: unique(rows.map(r => r.epic)), label: "Epic" },
    story:    { type: "select", options: unique(rows.map(r => r.userStory)), label: "Story" },
    status:   { type: "select", options: ["Passed","Failed","Blocked","Partially passed","Not run"], label: "Status" },
    section:  { type: "select", options: unique(rows.map(r => r.section)), label: "Section" },
    env:      { type: "select", options: unique(rows.map(r => r.environment)), label: "Env" },
    type:     { type: "select", options: unique(rows.map(r => r.testingType)), label: "Type" },
    author:   { type: "select", options: unique(rows.map(r => r.author)), label: "Author" },
    assignee: { type: "select", options: unique(rows.flatMap(r => r.assignees.map(a => a.login))), label: "Assignee" },
  };

  for (const [key, f] of Object.entries(filters)) {
    if (f.type === "search") {
      const input = document.createElement("input");
      input.type = "search";
      input.placeholder = f.placeholder;
      input.dataset.filter = key;
      input.value = params.get(key) || "";
      input.addEventListener("input", applyFilters);
      filterBar.appendChild(input);
    } else {
      const sel = document.createElement("select");
      sel.dataset.filter = key;
      sel.innerHTML = `<option value="">${f.label}</option>` + f.options.map(o => `<option value="${h(o)}" ${params.get(key) === o ? "selected" : ""}>${h(o)}</option>`).join("");
      sel.addEventListener("change", applyFilters);
      filterBar.appendChild(sel);
    }
  }

  const resetBtn = document.createElement("button");
  resetBtn.className = "filter-reset";
  resetBtn.textContent = "Reset";
  resetBtn.addEventListener("click", () => {
    filterBar.querySelectorAll("select").forEach(s => s.value = "");
    filterBar.querySelectorAll("input").forEach(i => i.value = "");
    applyFilters();
  });
  filterBar.appendChild(resetBtn);

  const countEl = document.createElement("span");
  countEl.className = "filter-count";
  filterBar.appendChild(countEl);

  let sortKey = "number", sortDir = -1;
  let expandedNum = null;

  function applyFilters() {
    const vals = {};
    filterBar.querySelectorAll("[data-filter]").forEach(el => {
      vals[el.dataset.filter] = el.value.trim().toLowerCase();
    });

    // Persist in URL
    const ps = new URLSearchParams();
    for (const [k, v] of Object.entries(vals)) { if (v) ps.set(k, v); }
    const newHash = `#/tests${ps.toString() ? "?" + ps.toString() : ""}`;
    if (window.location.hash !== newHash) history.replaceState(null, "", newHash);

    let filtered = rows.filter(r => {
      if (vals.search && !String(r.number).includes(vals.search) && !r.title.toLowerCase().includes(vals.search)) return false;
      if (vals.epic && r.epic.toLowerCase() !== vals.epic) return false;
      if (vals.story && r.userStory.toLowerCase() !== vals.story) return false;
      if (vals.status && r.status.toLowerCase() !== vals.status) return false;
      if (vals.section && r.section.toLowerCase() !== vals.section) return false;
      if (vals.env && r.environment.toLowerCase() !== vals.env) return false;
      if (vals.type && r.testingType.toLowerCase() !== vals.type) return false;
      if (vals.author && r.author.toLowerCase() !== vals.author) return false;
      if (vals.assignee && !r.assignees.some(a => a.login.toLowerCase() === vals.assignee)) return false;
      return true;
    });

    // Sort
    filtered.sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === "string") { va = va.toLowerCase(); vb = (vb || "").toLowerCase(); }
      if (va < vb) return -1 * sortDir;
      if (va > vb) return 1 * sortDir;
      return 0;
    });

    countEl.textContent = filtered.length === rows.length ? `${rows.length} test cases` : `${filtered.length} of ${rows.length}`;

    renderTable(filtered);
  }

  function renderTable(data) {
    const wrap = $("#test-table-wrap");
    if (data.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">No test cases match</div><div class="empty-sub">Try adjusting your filters</div></div>`;
      return;
    }

    const cols = [
      { key: "number", label: "#", w: "60px" },
      { key: "title", label: "Title" },
      { key: "status", label: "Status", w: "110px" },
      { key: "epic", label: "Epic", w: "60px" },
      { key: "section", label: "Section", w: "100px" },
      { key: "assignees", label: "Assignees", w: "90px", noSort: true },
    ];

    let html = `<table class="test-table"><thead><tr>`;
    for (const col of cols) {
      const sorted = sortKey === col.key;
      const arrow = sorted ? (sortDir === 1 ? "▲" : "▼") : "▽";
      html += `<th data-col="${col.key}" class="${sorted ? "sorted" : ""}" style="${col.w ? "width:" + col.w : ""}" ${col.noSort ? "style=\"cursor:default\"" : ""}>${col.label} ${col.noSort ? "" : `<span class="sort-arrow">${arrow}</span>`}</th>`;
    }
    html += `</tr></thead><tbody>`;

    for (const r of data) {
      const isExp = expandedNum === r.number;
      html += `<tr data-num="${r.number}" class="${isExp ? "expanded" : ""}">`;
      html += `<td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-dim)">#${r.number}</td>`;
      html += `<td style="font-weight:500;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(r.title)}</td>`;
      html += `<td><span class="status-pill"><span class="status-dot ${statusClass(r.status)}"></span>${h(r.status)}</span></td>`;
      html += `<td style="font-weight:600;font-size:11px">${h(r.epic)}</td>`;
      html += `<td style="font-size:11px;color:var(--text-secondary)">${h(r.section)}</td>`;
      html += `<td><div class="avatar-stack">${r.assignees.slice(0, 3).map(a => `<img class="avatar" src="${h(a.avatar)}&s=44" alt="${h(a.login)}" title="${h(a.login)}">`).join("")}${r.assignees.length > 3 ? `<span style="font-size:10px;color:var(--text-dim);margin-left:4px">+${r.assignees.length - 3}</span>` : ""}</div></td>`;
      html += `</tr>`;

      // Detail row
      html += `<tr class="row-detail ${isExp ? "open" : ""}" data-detail="${r.number}"><td colspan="${cols.length}">`;
      html += `<div class="detail-grid">`;
      html += `<div><div class="detail-item-label">Epic</div><div class="detail-item-value">${h(r.epicLabel || r.epic)}</div></div>`;
      html += `<div><div class="detail-item-label">User Story</div><div class="detail-item-value">${h(r.userStoryLabel || r.userStory)}</div></div>`;
      html += `<div><div class="detail-item-label">Testing Type</div><div class="detail-item-value">${h(r.testingType)}</div></div>`;
      html += `<div><div class="detail-item-label">Environment</div><div class="detail-item-value">${h(r.environment)}</div></div>`;
      html += `<div><div class="detail-item-label">OS</div><div class="detail-item-value">${h(r.os || "—")}</div></div>`;
      html += `<div><div class="detail-item-label">Browser</div><div class="detail-item-value">${h(r.browser || "—")}</div></div>`;
      html += `<div><div class="detail-item-label">Created</div><div class="detail-item-value">${relTime(r.createdAt)}</div></div>`;
      html += `<div><div class="detail-item-label">Updated</div><div class="detail-item-value">${relTime(r.updatedAt)}</div></div>`;
      if (r.crossOs) html += `<div><div class="detail-item-label">Cross-OS</div><div class="detail-item-value">✓</div></div>`;
      if (r.crossBrowser) html += `<div><div class="detail-item-label">Cross-Browser</div><div class="detail-item-value">✓</div></div>`;
      if (r.bugFound) html += `<div><div class="detail-item-label">Bug Found</div><div class="detail-item-value" style="color:var(--status-failed)">Yes</div></div>`;
      html += `</div>`;
      if (r.description) html += `<div class="detail-desc">${h(r.description)}</div>`;
      html += `<a class="detail-link" href="${h(r.url)}" target="_blank" rel="noopener">🔗 View on GitHub →</a>`;
      html += `</td></tr>`;
    }

    html += `</tbody></table>`;
    wrap.innerHTML = html;

    // Sort handlers
    wrap.querySelectorAll("th[data-col]").forEach(th => {
      if (th.parentElement.querySelector(`[data-col="${th.dataset.col}"]`)?.style.cursor === "default") return;
      th.addEventListener("click", () => {
        if (sortKey === th.dataset.col) { sortDir *= -1; }
        else { sortKey = th.dataset.col; sortDir = 1; }
        applyFilters();
      });
    });

    // Expand handlers
    wrap.querySelectorAll("tr[data-num]").forEach(tr => {
      tr.addEventListener("click", () => {
        const num = parseInt(tr.dataset.num);
        expandedNum = expandedNum === num ? null : num;
        // Toggle detail row
        const detail = wrap.querySelector(`tr[data-detail="${num}"]`);
        if (detail) {
          const wasOpen = detail.classList.contains("open");
          wrap.querySelectorAll(".row-detail.open").forEach(d => d.classList.remove("open"));
          wrap.querySelectorAll("tr.expanded").forEach(t => t.classList.remove("expanded"));
          if (!wasOpen) {
            detail.classList.add("open");
            tr.classList.add("expanded");
          }
        }
      });
    });
  }

  applyFilters();
}

// ═══════════════════════════════════════════════════════════════════════════
// COVERAGE
// ═══════════════════════════════════════════════════════════════════════════
function renderCoverage(view) {
  view.innerHTML = `
    <div class="section-header">
      <div class="section-title">Coverage</div>
      <div class="section-sub">Traceability matrix, gap analysis, and workload</div>
    </div>
    <div class="card coverage-matrix" style="margin-bottom:24px">
      <div class="card-title">Requirements Traceability</div>
      <div id="cov-matrix"></div>
    </div>
    <div class="card" style="margin-bottom:24px" id="gap-card">
      <div class="card-title" id="gap-title">Coverage Gaps</div>
      <ul class="gap-list" id="gap-list"></ul>
    </div>
    <div class="coverage-grid">
      <div class="card">
        <div class="card-title">Section × Type Heatmap</div>
        <div id="heatmap-wrap"></div>
      </div>
      <div class="card">
        <div class="card-title">Assignee Workload</div>
        <div id="workload-wrap"></div>
      </div>
    </div>
  `;

  renderCoverageMatrix();
  renderGaps();
  renderHeatmap();
  renderWorkload();
}

function renderCoverageMatrix() {
  const wrap = $("#cov-matrix");
  // Build Epic × Story grid
  // Only show epics that have stories
  const epicsWithStories = config.epics.filter(ep =>
    config.userStories.some(us => us.epicId === ep.id)
  );
  // All stories sorted by epic
  const allStories = config.userStories;

  // Get unique story IDs across all epics
  const storyIds = unique(allStories.map(us => us.id));

  let html = `<table class="cov-table"><thead><tr><th>Epic</th>`;
  for (const sid of storyIds) {
    const us = allStories.find(u => u.id === sid);
    html += `<th title="${h(us?.label || sid)}">${sid}</th>`;
  }
  html += `</tr></thead><tbody>`;

  for (const ep of epicsWithStories) {
    const epicStories = allStories.filter(us => us.epicId === ep.id);
    html += `<tr><td>${h(ep.id)}: ${h(ep.label.replace(/^Epic \w+:\s*/, ""))}</td>`;
    for (const sid of storyIds) {
      const belongsToEpic = epicStories.some(us => us.id === sid);
      const tcs = rows.filter(r => r.epic === ep.id && r.userStory === sid);

      if (!belongsToEpic) {
        html += `<td><div class="cov-cell" style="opacity:0.3"><span class="cov-empty">·</span></div></td>`;
      } else if (tcs.length === 0) {
        html += `<td><div class="cov-cell cov-gap" data-epic="${ep.id}" data-story="${sid}"><span class="cov-empty" style="color:var(--status-failed)">0</span></div></td>`;
      } else {
        const dots = tcs.slice(0, 5).map(r => `<div class="cov-dot" style="background:var(--status-${statusClass(r.status)})"></div>`).join("");
        html += `<td><div class="cov-cell" data-epic="${ep.id}" data-story="${sid}"><span class="cov-count">${tcs.length}</span><div class="cov-dots">${dots}</div></div></td>`;
      }
    }
    html += `</tr>`;
  }

  html += `</tbody></table>`;
  wrap.innerHTML = html;

  // Click handlers
  wrap.querySelectorAll(".cov-cell[data-epic]").forEach(cell => {
    cell.addEventListener("click", () => {
      navigate(`#/tests?epic=${cell.dataset.epic}&story=${cell.dataset.story}`);
    });
  });
}

function renderGaps() {
  const list = $("#gap-list");
  const gaps = [];

  for (const ep of config.epics) {
    const stories = config.userStories.filter(us => us.epicId === ep.id);
    for (const us of stories) {
      const tcs = rows.filter(r => r.epic === ep.id && r.userStory === us.id);
      if (tcs.length === 0) {
        gaps.push({ type: "critical", epic: ep, story: us, text: "No test cases. 0 coverage.", sub: "" });
      } else {
        const allNotRun = tcs.every(r => r.status === "Not run");
        if (allNotRun) {
          gaps.push({ type: "warning", epic: ep, story: us, text: `${tcs.length} test case${tcs.length > 1 ? "s" : ""}, all Not Run.`, sub: "0% executed" });
        }
        const allFailed = tcs.length > 0 && tcs.every(r => r.status === "Failed");
        if (allFailed && !allNotRun) {
          gaps.push({ type: "critical", epic: ep, story: us, text: `${tcs.length} test case${tcs.length > 1 ? "s" : ""}, all Failed.`, sub: "0% pass rate" });
        }
      }
    }
  }

  $("#gap-title").textContent = `Coverage Gaps (${gaps.length})`;

  if (gaps.length === 0) {
    list.innerHTML = `<li class="gap-item" style="justify-content:center;color:var(--status-passed);font-weight:600">✓ No coverage gaps found</li>`;
    return;
  }

  list.innerHTML = gaps.map(g => `
    <li class="gap-item">
      <div class="gap-icon ${g.type}"></div>
      <div>
        <div class="gap-text-main">${h(g.epic.id)}: ${h(g.epic.label.replace(/^Epic \w+:\s*/, ""))} → ${h(g.story.id)}: ${h(g.story.label)}</div>
        <div class="gap-text-sub">${h(g.text)} ${g.sub ? g.sub : ""}</div>
      </div>
    </li>
  `).join("");
}

function renderHeatmap() {
  const wrap = $("#heatmap-wrap");
  const sections = config.websiteSections;
  const types = config.testingTypes;

  // Count
  const counts = {};
  let maxCount = 0;
  for (const s of sections) {
    counts[s] = {};
    for (const t of types) {
      const n = rows.filter(r => r.section === s && r.testingType === t).length;
      counts[s][t] = n;
      if (n > maxCount) maxCount = n;
    }
  }

  const hmLevel = (n) => {
    if (n === 0) return 0;
    const pct = n / maxCount;
    if (pct <= 0.25) return 1;
    if (pct <= 0.5) return 2;
    if (pct <= 0.75) return 3;
    return 4;
  };

  let html = `<table class="heatmap-table"><thead><tr><th></th>`;
  // Abbreviate type names
  const abbr = (s) => s.length > 10 ? s.slice(0, 8) + "…" : s;
  html += types.map(t => `<th title="${h(t)}">${h(abbr(t))}</th>`).join("");
  html += `</tr></thead><tbody>`;

  for (const s of sections) {
    html += `<tr><th>${h(s)}</th>`;
    for (const t of types) {
      const n = counts[s][t];
      html += `<td class="hm-cell hm-${hmLevel(n)}" data-section="${h(s)}" data-type="${h(t)}" title="${s} × ${t}: ${n}">${n}</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll(".hm-cell").forEach(cell => {
    cell.addEventListener("click", () => {
      navigate(`#/tests?section=${encodeURIComponent(cell.dataset.section)}&type=${encodeURIComponent(cell.dataset.type)}`);
    });
  });
}

function renderWorkload() {
  const wrap = $("#workload-wrap");
  const assigneeCounts = {};
  let unassigned = 0;

  for (const r of rows) {
    if (r.assignees.length === 0) { unassigned++; continue; }
    for (const a of r.assignees) {
      if (!assigneeCounts[a.login]) assigneeCounts[a.login] = { login: a.login, avatar: a.avatar, total: 0, done: 0 };
      assigneeCounts[a.login].total++;
      if (r.status === "Passed" || r.status === "Failed" || r.status === "Partially passed") assigneeCounts[a.login].done++;
    }
  }

  const sorted = Object.values(assigneeCounts).sort((a, b) => b.total - a.total);
  const maxTotal = sorted[0]?.total || 1;

  let html = "";
  for (const a of sorted) {
    const pct = Math.round((a.total / maxTotal) * 100);
    html += `
      <div class="workload-row" data-assignee="${h(a.login)}">
        <div class="workload-name"><img class="avatar" src="${h(a.avatar)}&s=36" alt="" style="width:18px;height:18px">${h(a.login)}</div>
        <div class="workload-bar"><div class="workload-bar-fill" style="width:${pct}%;background:var(--accent)"></div></div>
        <div class="workload-count">${a.total} (${a.done} done)</div>
      </div>
    `;
  }

  if (unassigned > 0) {
    html += `
      <div class="workload-row workload-unassigned" data-assignee="">
        <div class="workload-name">Unassigned</div>
        <div class="workload-bar"><div class="workload-bar-fill" style="width:${Math.round((unassigned / maxTotal) * 100)}%;background:var(--status-failed)"></div></div>
        <div class="workload-count">${unassigned}</div>
      </div>
    `;
  }

  wrap.innerHTML = html || `<div style="color:var(--text-dim);font-size:12px;text-align:center;padding:16px">No assignees yet</div>`;

  wrap.querySelectorAll(".workload-row[data-assignee]").forEach(row => {
    row.addEventListener("click", () => {
      const login = row.dataset.assignee;
      if (login) navigate(`#/tests?assignee=${login}`);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GUIDE
// ═══════════════════════════════════════════════════════════════════════════
function renderGuide(view) {
  // Build copy-paste examples from actual config
  const lastEpic = config.epics[config.epics.length - 1];
  const nextEpicId = lastEpic ? lastEpic.id.replace(/\d+/, n => parseInt(n) + 1) : "E1";
  const lastUs = config.userStories[config.userStories.length - 1];
  const nextUsId = lastUs ? "US" + (parseInt(lastUs.id.replace("US", "")) + 1) : "US1";

  const epicExample = `{ "id": "${nextEpicId}", "label": "Epic ${nextEpicId}: Your Epic Name", "issue": 99 }`;
  const usExample = `{ "id": "${nextUsId}", "label": "Your story description", "issue": 100, "epicId": "${nextEpicId}" }`;

  // Label table from config
  const labelRows = [
    ...config.epics.map(e => ({ name: `epic: ${e.id}`, desc: e.label, by: "Auto-label" })),
    ...config.userStories.slice(0, 5).map(us => ({ name: `story: ${us.id}`, desc: us.label, by: "Auto-label" })),
    { name: "...", desc: `${config.userStories.length} total user stories`, by: "" },
    ...config.testingTypes.map(t => ({ name: `type: ${t}`, desc: "", by: "Auto-label" })),
    ...config.websiteSections.map(s => ({ name: `section: ${s}`, desc: "", by: "Auto-label" })),
    ...config.environments.map(e => ({ name: `env: ${e}`, desc: "", by: "Auto-label" })),
    ...config.executionStatuses.map(s => ({ name: `status: ${s}`, desc: "", by: "Test Execution" })),
    { name: "bug-found", desc: "A bug was linked", by: "Test Execution" },
    { name: "cross-os", desc: "Multi-OS test", by: "Form + /cross-os" },
    { name: "cross-browser", desc: "Multi-browser test", by: "Form + /cross-browser" },
    { name: "needs-review", desc: "Epic/Story mismatch", by: "Auto-label" },
    { name: "Test_Case", desc: "Gate label for all workflows", by: "Issue template" },
  ];

  view.innerHTML = `
    <div class="guide-content">
      <div class="section-header">
        <div class="section-title">Guide</div>
        <div class="section-sub">Everything you need to use Peviitor TC</div>
      </div>

      <h2>🚀 Getting Started (First-Time Setup)</h2>
      <p>Follow these steps when setting up the repo for the first time:</p>
      <ol>
        <li><span class="step-num">1</span> Push this codebase to your GitHub repository.</li>
        <li><span class="step-num">2</span> Go to <strong>Actions → Bootstrap Labels → Run workflow</strong>. This creates ~50 managed labels with correct colors.</li>
        <li><span class="step-num">3</span> Go to <strong>Settings → Pages</strong> → set source to <code>main</code> branch, <code>/docs</code> folder. This enables the dashboard.</li>
        <li><span class="step-num">4</span> Go to <strong>Actions → Test Matrix → Run workflow</strong>. This generates the initial dashboard.</li>
        <li><span class="step-num">5</span> Create your first test case using <strong>Issues → New Issue → Test Case</strong>.</li>
      </ol>
      <div class="callout">💡 After step 5, the <strong>Auto-Label</strong> and <strong>Test Execution</strong> workflows will trigger automatically on future issues and comments.</div>

      <h2>✏️ Creating a Test Case</h2>
      <h3>Title Format</h3>
      <pre><code>TC - [Feature] - [Action] - [Expected Result]</code></pre>
      <p>Example: <code>TC - Footer links - Hover and click - Correct pages open</code></p>

      <h3>How to Fill the Form</h3>
      <ol>
        <li>Go to <strong>Issues → New Issue → Test Case</strong>.</li>
        <li>Pick the <strong>Epic</strong> first. Epics group related features (e.g., Footer, Search).</li>
        <li>Pick the <strong>User Story</strong>. Options are prefixed with the Epic code (e.g., <code>F1 · US1</code>) so you can match them.</li>
        <li>Fill in <strong>Summary</strong>, <strong>Description</strong>, and at least 3 <strong>Test Steps</strong>.</li>
        <li>Each step should have <strong>one action</strong> and <strong>one expected result</strong> as a checkbox.</li>
      </ol>
      <div class="callout callout-warn">⚠️ <strong>Never edit the issue body after creation.</strong> Use slash commands in comments to record execution results.</div>

      <h2>⚡ Executing a Test Case</h2>
      <p>Post a comment on the test case issue with any of these commands:</p>
      <table>
        <thead><tr><th>Command</th><th>What it does</th></tr></thead>
        <tbody>
          <tr><td><code>/status passed</code></td><td>✅ Mark as passed</td></tr>
          <tr><td><code>/status failed</code></td><td>❌ Mark as failed (add bug link!)</td></tr>
          <tr><td><code>/status blocked</code></td><td>🟡 Mark as blocked</td></tr>
          <tr><td><code>/status partially-passed</code></td><td>🟠 Partial pass</td></tr>
          <tr><td><code>/status not-run</code></td><td>⚪ Reset to not run</td></tr>
          <tr><td><code>/bug https://github.com/org/repo/issues/42</code></td><td>🐛 Link a bug (use full URL for cross-repo)</td></tr>
          <tr><td><code>/bug #123</code></td><td>🐛 Link a same-repo bug</td></tr>
          <tr><td><code>/note your observation here</code></td><td>📝 Log a note without changing status</td></tr>
          <tr><td><code>/cross-os</code></td><td>Toggle cross-OS flag</td></tr>
          <tr><td><code>/cross-browser</code></td><td>Toggle cross-browser flag</td></tr>
        </tbody>
      </table>
      <p>Multiple commands can appear in one comment. The bot will reply with a summary and sync labels automatically.</p>

      <h2>📁 JSON Config Structure</h2>
      <p>All dropdown options, labels, and dashboard data flow from a single file:</p>
      <pre><code>config/epics-and-stories.json</code></pre>

      <h3>Adding a New Epic</h3>
      <p>Add to the <code>"epics"</code> array. Replace <code>99</code> with the actual issue number:</p>
      <div class="copy-block">
        <pre><code>${h(epicExample)}</code></pre>
        <button class="copy-btn" data-copy='${h(epicExample)}'>Copy</button>
      </div>

      <h3>Adding a New User Story</h3>
      <p>Add to the <code>"userStories"</code> array. The <code>epicId</code> must match an existing Epic:</p>
      <div class="copy-block">
        <pre><code>${h(usExample)}</code></pre>
        <button class="copy-btn" data-copy='${h(usExample)}'>Copy</button>
      </div>

      <h3>Other Arrays</h3>
      <p>You can also edit <code>testingTypes</code>, <code>websiteSections</code>, <code>environments</code>, and <code>executionStatuses</code>. Just add strings to the arrays.</p>

      <h2>🏷️ Labels</h2>
      <p>All labels are managed automatically. Here's the full taxonomy:</p>
      <table>
        <thead><tr><th>Label</th><th>Description</th><th>Managed By</th></tr></thead>
        <tbody>
          ${labelRows.map(l => `<tr><td><code>${h(l.name)}</code></td><td>${h(l.desc)}</td><td>${h(l.by)}</td></tr>`).join("")}
        </tbody>
      </table>

      <h2>🔄 Workflows — When to Run What</h2>

      <h3>Scenario A: First-Time Setup</h3>
      <pre><code>1. Bootstrap Labels     ← creates all labels (run manually)
2. Generate Template    ← creates issue form (auto-runs on push)
3. Test Matrix          ← generates dashboard (auto-runs on issue events)
4. Create a test issue  ← triggers Auto-Label automatically</code></pre>

      <h3>Scenario B: After Adding Epics/Stories</h3>
      <pre><code>1. Edit config/epics-and-stories.json
2. Push to main
   → Generate Template auto-runs (updates issue form dropdowns)
3. Run Bootstrap Labels manually (creates new labels)
4. Run Test Matrix manually (updates dashboard — or wait for next issue event)</code></pre>

      <div class="callout">💡 <strong>Generate Template</strong> runs automatically when you push changes to the config file. <strong>Bootstrap Labels</strong> always needs a manual run.</div>

      <h2>❓ FAQ</h2>
      <table>
        <thead><tr><th>Question</th><th>Answer</th></tr></thead>
        <tbody>
          <tr><td>What if I picked the wrong Epic/Story?</td><td>Edit the issue body. Auto-Label will re-run and fix the labels.</td></tr>
          <tr><td>Why does my issue have <code>needs-review</code>?</td><td>The Epic and User Story don't match (different prefix). Fix the selection.</td></tr>
          <tr><td>Can I edit the issue body after creation?</td><td>Only to fix form fields. Use <code>/status</code> and <code>/bug</code> commands for execution.</td></tr>
          <tr><td>Where do I report bugs?</td><td>In your bugs repo. Then link with <code>/bug &lt;url&gt;</code> on the test case.</td></tr>
          <tr><td>How do I see the dashboard?</td><td>Visit <code>https://${owner}.github.io/${repoName}/</code></td></tr>
        </tbody>
      </table>
    </div>
  `;

  // Copy button handlers
  view.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(btn.dataset.copy).then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => btn.textContent = "Copy", 1500);
      });
    });
  });
}

})();
