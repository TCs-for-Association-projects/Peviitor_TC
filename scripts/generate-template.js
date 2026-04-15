#!/usr/bin/env node
/**
 * generate-template.js
 * Reads config/epics-and-stories.json and writes .github/ISSUE_TEMPLATE/test_case.yml
 *
 * Run locally: node scripts/generate-template.js
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const config = JSON.parse(
  readFileSync(resolve(root, "config/epics-and-stories.json"), "utf8")
);

// ── Build dropdown option strings ────────────────────────────────────────────
const epicOptions = config.epics
  .map((e) => `      - "${e.label} (#${e.issue})"`)
  .join("\n");

const userStoryOptions = config.userStories
  .map((us) => `      - "${us.epicId} · ${us.id}: ${us.label} (#${us.issue})"`)
  .join("\n");

const testingTypeOptions = config.testingTypes
  .map((t) => `      - "${t}"`)
  .join("\n");

const websiteSectionOptions = config.websiteSections
  .map((s) => `      - "${s}"`)
  .join("\n");

const environmentOptions = config.environments
  .map((e) => `      - "${e}"`)
  .join("\n");

// ── Build YAML ───────────────────────────────────────────────────────────────
const yaml = `# AUTO-GENERATED — edit config/epics-and-stories.json and re-run:
#   node scripts/generate-template.js
# Do NOT hand-edit this file.

name: Test Case
description: Create a structured QA test case linked to an Epic and User Story
title: "[TC]: "
labels: ["Test_Case"]

body:

  # ── Guidelines & Quick Reference ───────────────────────────────────────────
  - type: markdown
    attributes:
      value: |
        > **📖 Before you start** — search existing test cases to avoid duplicates.
        > Need help? See the [QA Notion Guide](https://brave-mandevilla-652.notion.site/QA-Guide-Asociatia-Oportunitati-si-Cariere-1ae185f480ff801db946d012460e564b).

        <details>
        <summary><strong>📋 Authoring &amp; Execution Guide — click to expand</strong></summary>

        #### ✏️ Title format
        \`TC - [Feature] - [Action] - [Expected Result]\`
        > Example: \`TC - Footer links - Hover and click - Correct pages open\`

        ---

        #### 🏷️ Epic / User Story matching
        Pick the **Epic** first, then the matching **User Story**. US options are prefixed with the Epic code (\`F1 · US1\`) so you can match them easily. If they don't match, the bot flags the issue with \`needs-review\`.

        ---

        #### ⚡ Executing a test (for testers)
        **Do not edit the issue body after creation.** Use **comment slash-commands** instead:

        | Command | What it does |
        |---|---|
        | \`/status passed\` | ✅ Mark as passed |
        | \`/status failed #123\` | ❌ Mark as failed + link bug |
        | \`/status blocked\` | 🟡 Mark as blocked |
        | \`/status partially-passed\` | 🟠 Partial pass |
        | \`/bug #123\` | 🐛 Link or update the related bug |
        | \`/cross-os\` | Toggle cross-OS flag |
        | \`/cross-browser\` | Toggle cross-browser flag |

        The bot will reply with a formatted summary and sync all labels automatically.

        ---

        #### ✅ Step writing tips
        - One expected result per step — use checkboxes
        - Steps must be **repeatable** by someone who didn't write them
        - Keep steps atomic: one action = one step

        </details>

  # ── 🏷️ Traceability ───────────────────────────────────────────────────────
  - type: markdown
    attributes:
      value: |
        ---
        ## 🏷️ Traceability
        > Link this test case to its Epic and User Story for tracking.

  - type: dropdown
    id: epic
    attributes:
      label: Epic
      description: "Select the Epic this test case belongs to."
      options:
${epicOptions}
    validations:
      required: true

  - type: dropdown
    id: user_story
    attributes:
      label: User Story
      description: "Options are prefixed with the Epic code — pick the one matching your Epic."
      options:
${userStoryOptions}
    validations:
      required: true

  # ── 📝 Test Definition ────────────────────────────────────────────────────
  - type: markdown
    attributes:
      value: |
        ---
        ## 📝 Test Definition
        > Describe what this test case verifies and any setup needed.

  - type: input
    id: tc_summary
    attributes:
      label: Summary
      description: "One-line title in TC format."
      placeholder: "TC – Footer links – Hover and click – Correct pages open"
    validations:
      required: true

  - type: textarea
    id: description
    attributes:
      label: Description
      description: "What is being verified and why?"
      placeholder: "Verifies that all footer navigation links redirect to the correct pages on peviitor.ro."
    validations:
      required: true

  - type: textarea
    id: preconditions
    attributes:
      label: Preconditions
      description: "Optional. Any setup required before running this test."
      placeholder: |
        - Browser open, navigated to peviitor.ro
        - User is not logged in

  - type: textarea
    id: test_data
    attributes:
      label: Test Data
      description: "Optional. Input values, credentials, or datasets needed."
      placeholder: |
        - Search term: 'developer'
        - City: 'Cluj-Napoca'

  - type: dropdown
    id: testing_type
    attributes:
      label: Testing Type
      description: "What kind of testing does this case cover?"
      options:
${testingTypeOptions}
    validations:
      required: true

  - type: dropdown
    id: website_section
    attributes:
      label: Website Section
      description: "Which part of peviitor.ro does this target?"
      options:
${websiteSectionOptions}
    validations:
      required: true

  # ── 💻 Environment ────────────────────────────────────────────────────────
  - type: markdown
    attributes:
      value: |
        ---
        ## 💻 Environment
        > Where and how will this test be executed?

  - type: dropdown
    id: test_context
    attributes:
      label: Test Environment
      description: "Where will this test be executed?"
      options:
${environmentOptions}
    validations:
      required: true

  - type: textarea
    id: env_details
    attributes:
      label: Environment Details
      description: "OS, browser, resolution, device — one per line."
      value: |
        OS: Windows 11
        Browser: Chrome 120
        Resolution: 1920x1080
        Device:
    validations:
      required: true

  - type: checkboxes
    id: cross_flags
    attributes:
      label: Cross-platform Coverage
      description: "Tick any that apply. The executor can toggle these later with /cross-os or /cross-browser."
      options:
        - label: "Should be run across multiple operating systems"
        - label: "Should be run across multiple browsers"

  # ── 🪜 Steps & Expected Results ───────────────────────────────────────────
  - type: markdown
    attributes:
      value: |
        ---
        ## 🪜 Steps & Expected Results
        > Write clear, repeatable steps. One expected result per step. Use checkboxes so the executor can mark them.

  - type: textarea
    id: test_steps
    attributes:
      label: Test Steps
      description: "One expected result per step. The executor will check off each result while running."
      value: |
        **Step 1.** [Describe the action]
        - [ ] Expected: [What should happen]

        **Step 2.** [Describe the action]
        - [ ] Expected: [What should happen]

        **Step 3.** [Describe the action]
        - [ ] Expected: [What should happen]

        **Step 4.** [Describe the action]
        - [ ] Expected: [What should happen]
    validations:
      required: true

  # ── ✅ Final Check ─────────────────────────────────────────────────────────
  - type: markdown
    attributes:
      value: |
        ---
        ## ✅ Final Check
        > ⚡ **Reminder:** After this test case is created, use **comment slash-commands** (\`/status passed\`, \`/bug #123\`, etc.) to record execution results — do not edit the issue body.

  - type: checkboxes
    id: quality_check
    attributes:
      label: Confirm before submitting
      options:
        - label: "Steps are clear and repeatable."
          required: true
        - label: "Epic and User Story match."
          required: true
`;

// ── Write output ─────────────────────────────────────────────────────────────
const outDir = resolve(root, ".github/ISSUE_TEMPLATE");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "test_case.yml"), yaml, "utf8");

console.log(`✓ Generated: .github/ISSUE_TEMPLATE/test_case.yml`);
console.log(`  Epics:        ${config.epics.length}`);
console.log(`  User Stories: ${config.userStories.length}`);
