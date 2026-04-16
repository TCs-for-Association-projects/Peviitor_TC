# Peviitor_TC — Project Context

## Purpose
QA test management repository for **peviitor.ro** (job search platform).  
No application source code lives here — GitHub Issues are the test cases.

## Repo: TheodorIvascu/Peviitor_TC

## Key files
| Path | Role |
|------|------|
| `config/epics-and-stories.json` | Single source of truth for all dropdown values, labels, and statuses |
| `scripts/generate-template.js` | Reads config → outputs `.github/ISSUE_TEMPLATE/test_case.yml` |
| `scripts/auto-label.js` | Parses issue body → syncs labels (epic:, story:, type:, section:, env:) |
| `scripts/test-execution.js` | Parses slash commands in comments (`/status`, `/bug`, `/cross-*`) → updates labels + posts summary |
| `scripts/bootstrap-labels.js` | Creates/updates all managed labels on the repo (idempotent) |
| `scripts/generate-matrix.js` | Fetches all Test_Case issues → generates `docs/test-matrix.{json,csv,html}` dashboard |
| `.github/ISSUE_TEMPLATE/test_case.yml` | AUTO-GENERATED issue form — do not hand-edit |
| `.github/workflows/` | 5 workflows: Auto_Label, Test_Execution, Bootstrap_Labels, Generate_Template, Test_Matrix |

## Test case title format
```
TC - [Feature] - [Action] - [Expected Result]
```
Example: `TC - Footer links - Hover and click - Correct pages open`

## Labels auto-applied by workflow
- Testing type (Navigation, Content testing, GUI and usability, …)
- Environment (Local, Staging, Production)
- Website section (Header, Footer, Search bar, Filters, Job listings, …)
- Cross-browser, Cross-OS
- Bug(s) found
- Epic and User Story (from dropdowns in the form)

## Execution model
- Test **authoring** happens via the issue form (create issue)
- Test **execution** happens via **comment slash-commands** — NOT by editing the issue body
- `/status passed|failed|blocked|partially-passed` — sets execution status labels
- `/bug #123` — links a bug issue and adds `bug-found` label
- `/cross-os`, `/cross-browser` — toggle cross-platform flags
- The bot replies with a formatted execution summary

## Workflow rule
Only issues already carrying the **Test_Case** label are processed by the auto-label workflow.

## External reference
[QA Notion Guide](https://brave-mandevilla-652.notion.site/QA-Guide-Asociatia-Oportunitati-si-Cariere-1ae185f480ff801db946d012460e564b)

## Important notes
- Epic / User Story options in the form are **static placeholders** — a later update will finalize them.
- The form supports authoring only; execution is done via comments.
- GitHub Issue Forms cannot conditionally show/hide fields or pull dynamic data at runtime.
- The dashboard lives at `docs/index.html` (Criterium SPA). `docs/test-matrix.html` is now a thin redirect for backward compatibility.

---

## Changelog — 2026-04-15 Session

### What was done

#### 1. Template Readability Overhaul
**Files modified:** `scripts/generate-template.js`, `.github/ISSUE_TEMPLATE/test_case.yml`

- Rewrote the issue form template with rich markdown section banners: `## 🏷️ Traceability`, `## 📝 Test Definition`, `## 💻 Environment`, `## 🪜 Steps & Expected Results`, `## ✅ Final Check`
- Each section has a blockquote description explaining its purpose
- Restructured the collapsible Guidelines (`<details>`) with a prominent slash-command reference table
- Added an execution reminder before the final checkboxes: "use comment slash-commands, don't edit the issue body"
- Added a 4th step in the step template placeholder
- Changed field labels for clarity: `Section` → `Website Section`, `Environment` → `Test Environment`, `Cross-platform coverage` → `Cross-platform Coverage`

#### 2. Comment-Based Execution Flow
**Files added:** `scripts/test-execution.js`, `.github/workflows/Test_Execution.yml`

- New script parses slash commands from issue comments: `/status`, `/bug`, `/cross-os`, `/cross-browser`
- Bot posts a formatted execution summary with:
  - Timestamp
  - Previous → New status transition table
  - Bug link if provided
  - ⚠️ Warning when `/status failed` is used without a bug reference
  - Link to the test matrix dashboard
- Labels are synced automatically (removes old `status:` label, adds new one)
- Workflow triggers on `issue_comment: [created]`, only on Test_Case issues, ignores bot comments

#### 3. Professional Dashboard
**Files modified:** `scripts/generate-matrix.js`, `docs/index.html`

- Complete rewrite of the HTML dashboard generator using Chart.js v4 (CDN)
- **KPI cards:** Total Test Cases, Passed, Failed, Blocked, Not Run, Bugs Found
- **Doughnut chart:** Execution status distribution
- **Stacked bar chart:** Test cases per Epic, broken down by status
- **Coverage heatmap:** Section × Testing Type matrix with color intensity
- **Data table:** Full filterable/sortable table with new columns: Author (avatar + name), Assignees (avatars), Created date
- **Dark/light theme toggle** (dark default, persisted to localStorage)
- **Filter bar:** Search + dropdowns for Epic, Story, Status, Section, Env, Type, Author
- **Row counter:** Shows "X of Y test cases" when filtering
- Now also outputs `docs/test-matrix.json` for data portability
- Status and bug-found are now read from **labels** (set by test-execution.js) instead of form fields
- Author and assignees extracted from GitHub API issue response

#### 4. Auto-Label Field Name Fixes
**File modified:** `scripts/auto-label.js`

- Fixed field name parsing to match the new template labels:
  - `fields["Section"]` → `fields["Website Section"]`
  - `fields["Environment"]` → `fields["Test Environment"]`
  - `fields["Cross-platform coverage"]` → `fields["Cross-platform Coverage"]`

#### 5. Workflow Race Condition Fix
**Files modified:** `.github/workflows/Test_Matrix.yml`, `.github/workflows/Generate_Template.yml`

- Added `git pull --rebase origin main` before `git push` in both auto-commit workflows
- Prevents push failures when concurrent workflows (Auto-Label, Test Execution) push to main at the same time
- Added `docs/test-matrix.json` to the Test_Matrix workflow's commit list

#### 6. Docs & Meta
- Updated `docs/index.html` redirect page to match dashboard styling
- Updated `CLAUDE.md` to reflect current architecture and correct repo name (`TheodorIvascu/Peviitor_TC`)

### Commits pushed
1. `da691b9` — `feat: improve template readability, add comment-based execution flow, and professional dashboard`
2. `5774dd8` — `fix: add git pull --rebase before push in workflows to prevent race condition failures`

### Testing checklist
1. Run **Bootstrap Labels** workflow (Actions → Bootstrap Labels → Run workflow)
2. Create a test issue using the new template — verify form readability
3. Test slash commands in issue comments (`/status passed`, `/status failed #1`, `/bug #2`, `/cross-os`)
4. Run **Test Matrix** workflow manually — verify dashboard at https://theodorivascu.github.io/Peviitor_TC/
5. Verify dark/light theme toggle, charts, filters, author/assignee columns

---

## Changelog — 2026-04-16 Session (Criterium redesign)

### What was done

#### 1. Jira-style SPA dashboard (Criterium)
**File rewritten:** `scripts/generate-matrix.js`

Replaced the single-page `test-matrix.html` with a proper SPA served at `docs/index.html`. Hash-based routing (`#/overview`, `#/test-cases`, `#/traceability`, `#/assignees`), embedded JSON payload (no fetch), Chart.js via CDN. Design language is Atlassian/Jira-inspired: dark sidebar nav, clean topbar with global search + `/` shortcut, bordered cards on a light main surface (dark theme mirrors this).

**Four routes:**
- **Overview** — 8 KPI cards (Total / Passed / Failed / Blocked / Not Run / Bugs / New-7d / Pass Rate), a Jira-style segmented status-breakdown bar (replaces the old doughnut), a horizontal stacked bar of test cases by Epic × status, recent-activity feed (top 8 most recently updated), and a grid of six small donut charts for dimensional distribution (Environment, Testing Type, Section, OS, Browser, User Story).
- **Test Cases** — full filter bar (search, Epic, Story, Status, Section, Env, Type, Author, Assignee, `✨ New (7d)` toggle). Filter state persists in the URL (`#/test-cases?assignee=alice&status=Failed`). Sortable columns. Clicking a row expands a detail panel with description, OS/browser, flags, updated-relative time, and a link to the GitHub issue. Empty-state illustration when filters produce no hits. Reset button.
- **Traceability** — collapsible Epic → User Story → Test Case tree. Each epic shows a multi-segment pass/fail/blocked/partial/not-run bar, total TC count, and "X/Y executed · Z% pass". Stories with zero test cases are explicitly flagged as gaps. Unmapped TCs (wrong story under correct epic) are surfaced in a separate block. Section × Testing Type heatmap lives here (moved from overview).
- **Assignees** — workload leaderboard. For each assignee: rank, avatar, login, assigned count, **bidirectional percentage** of total (rises on assign, falls on unassign), and a status-breakdown bar. "Unassigned" is its own row at the bottom, highlighted in danger red. Horizontal bar chart of top 10. Clicking a row deep-links to `#/test-cases?assignee=<login>`.

**UX details:** theme toggle (dark default, persists in localStorage), sidebar collapses on mobile, global search popover returns top 10 matches across title/description/number/author, "Powered by Criterium" badge in sidebar + inline footer credit, exports as `⬇ CSV` and `⬇ JSON`.

#### 2. Enriched CSV export
- UTF-8 **BOM** for Excel auto-detection.
- CRLF line endings (RFC 4180).
- **26 columns** (up from 18): added `Status Icon`, `Epic Label`, `Story Label`, `Assignees` (pipe-separated), `Assignee Count`, `Description (excerpt)`, `Days Open`, `Days Since Update`. `Cross-OS` / `Cross-Browser` / `Bug Found` now serialize as `yes`/`no` instead of raw booleans.
- Human-readable column headers (e.g. `Issue #`, `Status Icon`) instead of camelCase keys.

#### 3. Row schema changes (`test-matrix.json`)
`buildRow()` now extracts `description` (full text from the Issue body's **Description** field) plus `descriptionExcerpt` (160 chars, whitespace-collapsed). Added `daysSinceCreated` and `daysSinceUpdated` computed fields. These feed both the dashboard search and the CSV export.

#### 4. Redirect topology swap
- `docs/index.html` is now the Criterium SPA (was: a redirect to `test-matrix.html`).
- `docs/test-matrix.html` is now a thin redirect back to `index.html` (was: the monolithic dashboard). Old bookmarks and the slash-command summary link continue to work.

#### 5. README rewrite
Replaced the 2-line placeholder with a full project README: purpose, ASCII flow diagram, authoring/execution steps, slash-command reference, dashboard route tour, label taxonomy, workflow table, local scripts, first-time setup checklist, Criterium credit.

### Why no config/label changes
Reviewed `config/epics-and-stories.json` — the 11 epics / 25 user stories / 8 testing types / 8 sections / 3 environments / 5 statuses are coherent and already cover everything the new dashboard surfaces. Assignees come from GitHub's native field (not the form), creation/update timestamps come from the API — no new form fields or labels were necessary to unlock any of the new pages.

### Files changed
- `scripts/generate-matrix.js` — full rewrite (~1100 lines)
- `README.md` — rewritten
- `docs/index.html` — now the SPA
- `docs/test-matrix.html` — now the redirect
- `docs/test-matrix.csv` — new enriched format
- `docs/test-matrix.json` — new fields (description, days)
- `CLAUDE.md` — this changelog entry

### Testing checklist
1. Push and let **Test Matrix** regenerate `docs/` with real data (or run manually via `workflow_dispatch`).
2. Visit `https://theodorivascu.github.io/Peviitor_TC/` — lands on the Criterium overview.
3. Walk all four routes, toggle theme, try `/` shortcut for search.
4. On **Test Cases**: apply several filters, expand a row, copy the URL, paste in a new tab — filter state should restore.
5. On **Assignees**: click a row → should deep-link to filtered **Test Cases** view.
6. On **Traceability**: collapse/expand epics; verify gaps surface for empty stories.
7. Download the CSV, open in Excel — BOM should render Romanian/special characters correctly, all 26 columns present.
8. Old bookmark test: visit `/test-matrix.html` → should redirect to `/index.html`.

---

## Changelog — 2026-04-16 Session (Dashboard Refactor & Automation Fixes)

### What was done

#### 1. Slash Command Fixes (`scripts/test-execution.js`)
- Suppressed redundant "Not run → Failed" transitions when test cases are newly executed.
- Compact single-line execution summary for simple operations.
- Fixed `/bug` to correctly parse and link cross-repo URLs, properly displaying them as `org/repo#N`.
- Added new `/note <text>` command to log observations without mutating the test case status.

#### 2. Auto-Label Traceability linking (`scripts/auto-label.js`)
- Auto-label now posts a traceability comment linking the original **Epic** and **User Story** using GitHub issue URLs.
- Merged warning comments (like epic/story mismatches) and the traceability comment into a single bot response.

#### 3. Dashboard UI Rebuild (`scripts/dashboard/`)
- Rewrote the monolithic `generate-matrix.js` SPA (2,263 lines) into a cleaner file-based template assembly (`template.html`, `styles.css`, `app.js`).
- Complete UI redesign moving away from "Criterium" Atlassian clone to a Linear-inspired sleek gray monochrome, with a prominent top navigation bar and glassmorphism.
- The 4 pages are now: **Overview**, **Test Cases**, **Coverage** (traceability matrix), and **Guide** (beginner instructions with copy-paste JSON blocks).
- `generate-matrix.js` logic was shortened to ~270 lines for data fetching/CSV output and SPA template injection.

#### 4. GitHub Actions Updates
- `Auto_Label_Test_Case.yml` kept as issue-triggered only.
- Added a `push` trigger to `Bootstrap_Labels.yml` watching the `.json` config to auto-sync labels.
- Documentation cleaned up dropping old naming conventions to match the new dashboard.