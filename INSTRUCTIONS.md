# Peviitor_TC — Setup Instructions (English)

A step-by-step guide to get this QA test management repository fully operational from scratch. Follow the steps **in order** — each one depends on the previous ones.

> 🇷🇴 **Versiunea în română:** [`INSTRUCTIUNI.md`](./INSTRUCTIUNI.md)

---

## Before you start

You will need:
- A **GitHub account** with permission to create repositories and run workflows.
- A **web browser**. That's it for the basic flow.
- *(Optional, only for local development)* **Node.js 20 or newer** — download from <https://nodejs.org/>.

Total time: **about 15 minutes**, most of which is waiting for GitHub Actions to finish.

---

## Step 1 — Get the code into your GitHub repository

Pick one of the two options below.

### Option A: You already have this code on your machine

1. Create a **new empty repository** on GitHub (e.g. `Peviitor_TC`). Do not initialize it with a README.
2. Open a terminal in the project folder.
3. Connect the folder to your new repository:
   ```bash
   git remote set-url origin https://github.com/YOUR_USERNAME/Peviitor_TC.git
   git push -u origin main
   ```

### Option B: You are starting from someone else's repo

1. On GitHub, click the **Fork** button at the top right of the original repository.
2. GitHub will create a copy under your account. You're done with this step.

---

## Step 2 — Enable workflows

By default, GitHub Actions may be disabled on a new fork.

1. Go to your repository on GitHub.
2. Click the **Actions** tab.
3. If you see a yellow banner saying *"Workflows aren't being run on this forked repository"*, click **I understand my workflows, go ahead and enable them**.
4. You should now see 5 workflows listed in the left sidebar:
   - Auto-Label Test Case
   - Bootstrap Labels
   - Generate Test Case Template
   - Test Execution
   - Test Matrix

---

## Step 3 — Create the labels (run Bootstrap Labels)

This creates all ~50 colored labels (epics, stories, statuses, etc.) that the workflows need.

1. Go to **Actions** → click **Bootstrap Labels** in the left sidebar.
2. Click the **Run workflow** dropdown on the right.
3. Leave the branch as `main` and click the green **Run workflow** button.
4. Wait ~30 seconds. Refresh the page — the run should show a green checkmark.
5. Verify: go to **Issues → Labels**. You should see labels like `epic: F1`, `story: US1`, `status: Passed`, `Test_Case`, etc.

> ✅ **What this did:** created every label the dashboard and auto-label scripts will use. Safe to re-run any time you add new epics or stories in `config/epics-and-stories.json`.

---

## Step 4 — Generate the issue form template

The Test Case issue form is auto-generated from `config/epics-and-stories.json`.

1. Go to **Actions** → click **Generate Test Case Template**.
2. Click **Run workflow** → **Run workflow**.
3. Wait ~20 seconds. A new commit `chore: regenerate test_case.yml from config` should appear on `main`.

> ✅ **What this did:** wrote `.github/ISSUE_TEMPLATE/test_case.yml` from your config. Automatically re-runs whenever you edit the config file.

---

## Step 5 — Enable GitHub Pages (the dashboard)

1. Go to **Settings** (top right tab) → **Pages** (left sidebar).
2. Under **Source**, select **Deploy from a branch**.
3. Under **Branch**, pick `main` and the `/docs` folder. Click **Save**.
4. Wait ~1 minute. The page will show:
   > Your site is live at `https://YOUR_USERNAME.github.io/Peviitor_TC/`
5. Open that URL in a new tab. You should see the **QA dashboard** (possibly empty if there are no test cases yet).

---

## Step 6 — Generate the initial dashboard data

1. Go to **Actions** → click **Test Matrix**.
2. Click **Run workflow** → **Run workflow**.
3. Wait ~30 seconds. A new commit `chore: update test matrix` will appear on `main`.
4. Refresh your GitHub Pages URL. The dashboard now reflects all current Test_Case issues.

> ✅ **What this did:** fetched all issues labeled `Test_Case`, regenerated `docs/index.html`, `docs/test-matrix.json`, and `docs/test-matrix.csv`. This workflow also runs **automatically on every issue event** and **nightly at 03:00 UTC**.

---

## Step 7 — Create your first test case

1. Go to **Issues** → **New issue**.
2. Click **Get started** next to **Test Case**.
3. Fill in the form:
   - **Title** — use the format `TC - [Feature] - [Action] - [Expected Result]`
     *Example:* `TC - Footer links - Hover and click - Correct pages open`
   - **Epic** and **User Story** — pick matching ones (the user story is prefixed with the Epic code).
   - **Summary**, **Description**, **Testing Type**, **Website Section**, **Test Environment** — fill as applicable.
   - **Test Steps** — replace the placeholder with real steps, one expected result per checkbox.
4. Click **Submit new issue**.
5. Within ~10 seconds, a bot comment may appear (only if something was off — e.g. epic/story mismatch). Labels like `epic: F1`, `story: US1`, `type: Navigation`, `status: Not run` will be applied automatically.

---

## Step 8 — Execute a test case (as a tester)

**Do not edit the issue body after creation.** Use **comment slash-commands** instead.

1. Open the test case issue.
2. Scroll to the comment box at the bottom.
3. Type one or more commands:
   ```
   /status passed
   ```
   or
   ```
   /status failed #42
   /cross-browser
   ```
4. Click **Comment**.
5. Within ~10 seconds, the bot replies with a formatted execution summary showing the status transition, any bug links, and a link to the dashboard.

### Full command reference

| Command | What it does |
|---|---|
| `/status passed` | ✅ Mark as passed |
| `/status failed #123` | ❌ Mark as failed and link bug #123 |
| `/status blocked` | 🟡 Mark as blocked |
| `/status partially-passed` | 🟠 Partial pass |
| `/status not-run` | ⚪ Reset to not run |
| `/bug #123` | 🐛 Link a bug without changing status |
| `/note my observation` | 📝 Add an observation without changing status |
| `/cross-os` | Toggle the cross-OS flag |
| `/cross-browser` | Toggle the cross-browser flag |

You can combine multiple commands in one comment — each is processed in order.

> ⚠ **Always include a bug reference when marking as failed.** The bot warns you if you don't.

---

## Step 9 — View the dashboard

Refresh `https://YOUR_USERNAME.github.io/Peviitor_TC/`. The Test Matrix workflow runs automatically on every issue change, so your new test case and its execution status should appear within a minute.

**The four dashboard pages:**

- **Overview** — KPIs, status breakdown bar, epic chart, distribution donuts.
- **Test Cases** — filterable/sortable table. Try filters: epic, assignee, status.
- **Coverage** — interactive requirements tracebility matrix and gap analysis.
- **Guide** — built-in setup and beginner-friendly documentation with JSON copy-paste blocks.

**Shortcuts:**
- Press **`/`** anywhere to focus the global search.
- Click the **🌙 / ☀️** icon in the top-right to switch between dark and light themes.
- Use the **⬇ CSV** and **⬇ JSON** links in the footer to export data.

---

## Step 10 — Maintenance (ongoing)

### Add a new Epic or User Story

1. Edit `config/epics-and-stories.json` directly on GitHub (pencil icon on the file).
2. Add your new entry to the `epics` or `userStories` array, with a unique ID, label, and issue number.
3. Commit to `main`.
4. The **Generate Test Case Template** and **Bootstrap Labels** workflows run automatically to update the form and create any new labels.

### Add a new testing type, section, or environment

Same process — edit `config/epics-and-stories.json` and commit. The workflows will handle the rest.

### Something looks wrong on the dashboard

1. Go to **Actions** → **Test Matrix** → click **Run workflow** to force a regeneration.
2. Hard-refresh the dashboard page (`Ctrl+Shift+R` / `Cmd+Shift+R`).

---

## Troubleshooting

**Labels didn't apply to my new test case.**
→ The issue must have the `Test_Case` label. The issue template applies it automatically. If you created the issue without the template, add the label manually and the auto-label workflow will re-run.

**Slash command didn't work.**
→ Check the comment is on an issue that has the `Test_Case` label. Commands in the issue *body* are ignored — they must be in a *comment*.

**Dashboard is empty.**
→ You haven't run **Test Matrix** yet (Step 6), or there are no issues with the `Test_Case` label. Also make sure GitHub Pages is enabled (Step 5).

**Workflow failed with "permission denied" on push.**
→ Go to **Settings → Actions → General → Workflow permissions** and set it to **Read and write permissions**.

---

## Quick reference

| I want to… | Do this |
|---|---|
| Create a test case | Issues → New issue → Test Case template |
| Mark a test as passed | Comment `/status passed` on the issue |
| Mark as failed with bug | Comment `/status failed #123` on the issue |
| Add more epics | Edit `config/epics-and-stories.json` and push |
| Force dashboard refresh | Actions → Test Matrix → Run workflow |
| Export all data | Dashboard footer → ⬇ CSV or ⬇ JSON |

---

<sub>For full technical detail, see [`README.md`](./README.md).</sub>
