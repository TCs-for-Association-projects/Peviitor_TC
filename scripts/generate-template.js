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

// ── Load config ─────────────────────────────────────────────────────────────
const config = JSON.parse(
  readFileSync(resolve(root, "config/epics-and-stories.json"), "utf8")
);

// ── Build dropdown option strings ────────────────────────────────────────────

/** Epic dropdown: "Epic F1: Footer Navigation & Structure (#16)" */
const epicOptions = config.epics
  .map((e) => `      - "${e.label} (#${e.issue})"`)
  .join("\n");

/** User Story dropdown: "F1 · US1: Navigation links in footer (#17)" */
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

const executionStatusOptions = config.executionStatuses
  .map((s) => `      - "${s}"`)
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

  # ── Section 1: Guidelines ──────────────────────────────────────────────────
  - type: markdown
    attributes:
      value: |
        <details>
        <summary><strong>Guidelines — read before filling in the form</strong></summary>

        ### Who should complete what?
        - **Author** (person creating the test case): fill in everything except *Execution Status* and *Bug Discovery*.
        - **Executor** (person running the test): mark the Expected Results checkboxes inside the steps, set the *Execution Status* dropdown, and fill in the *Bug Discovery* section if applicable.

        ### Test case title format
        \`TC - [Feature] - [Action] - [Expected Result]\`
        > Example: \`TC - Footer links - Hover and click - Correct pages open\`

        ### Test steps format
        - One expected result per step.
        - Use checkboxes for expected results so the executor can mark them.
        - Steps must be **repeatable** — anyone should be able to run them and get the same result.

        ### Epic & User Story
        - Pick the **Epic** first, then pick the **User Story** that belongs to it.
        - The User Story options are prefixed with the Epic code (e.g. \`F1 · US1\`) to make matching easy.
        - If you are unsure which US applies, leave a comment on the issue.

        ### Before creating
        - Search existing test cases to avoid duplicates.
        - Check the [QA Notion Guide](https://brave-mandevilla-652.notion.site/QA-Guide-Asociatia-Oportunitati-si-Cariere-1ae185f480ff801db946d012460e564b) for conventions.

        </details>

  # ── Section 2: Traceability ────────────────────────────────────────────────
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
      description: "Select the User Story this test case covers. Options are prefixed with the Epic code."
      options:
${userStoryOptions}
    validations:
      required: true

  # ── Section 3: Test definition ─────────────────────────────────────────────
  - type: input
    id: tc_summary
    attributes:
      label: Test case summary
      description: "Short title following the TC naming format."
      placeholder: "TC – Footer links – Hover and click – Correct pages open"
    validations:
      required: true

  - type: textarea
    id: description
    attributes:
      label: Test Case Description
      description: "Brief purpose and scope of this test. What is being verified and why?"
      placeholder: "This test verifies that all footer navigation links redirect to the correct pages on peviitor.ro."
    validations:
      required: true

  - type: textarea
    id: preconditions
    attributes:
      label: Preconditions
      description: "Any setup required before running this test (e.g. user logged in, specific data present)."
      placeholder: "- Browser is open and navigated to peviitor.ro\\n- User is not logged in"

  - type: textarea
    id: test_data
    attributes:
      label: Test Data
      description: "Specific input values, credentials, or datasets needed for the test."
      placeholder: "- Search term: 'developer'\\n- City: 'Cluj-Napoca'"

  - type: dropdown
    id: testing_type
    attributes:
      label: Testing Type
      description: "What type of testing does this test case perform?"
      options:
${testingTypeOptions}
    validations:
      required: true

  - type: dropdown
    id: website_section
    attributes:
      label: Website Section
      description: "Which section of peviitor.ro does this test target?"
      options:
${websiteSectionOptions}
    validations:
      required: true

  # ── Section 4: Environment ─────────────────────────────────────────────────
  - type: dropdown
    id: test_context
    attributes:
      label: Test Environment
      description: "Where will this test be executed?"
      options:
${environmentOptions}
    validations:
      required: true

  - type: input
    id: resolution
    attributes:
      label: Screen Resolution
      description: "Optional. Resolution used during testing."
      placeholder: "1920x1080"

  - type: input
    id: os
    attributes:
      label: Operating System
      description: "OS and version used for this test."
      placeholder: "Windows 11, macOS 14, Ubuntu 22.04"
    validations:
      required: true

  - type: checkboxes
    id: cross_os
    attributes:
      label: Cross-OS
      options:
        - label: "This test case should be run across multiple operating systems."

  - type: input
    id: browser
    attributes:
      label: Browser
      description: "Browser and version used for this test."
      placeholder: "Chrome 120, Firefox 122, Safari 17"
    validations:
      required: true

  - type: checkboxes
    id: cross_browser
    attributes:
      label: Cross-Browser
      options:
        - label: "This test case should be run across multiple browsers."

  - type: input
    id: device
    attributes:
      label: Device / Devices
      description: "Optional. Device type or model if relevant."
      placeholder: "iPhone 14, Samsung Galaxy S23, iPad Pro"

  # ── Section 5: Steps & expectations ───────────────────────────────────────
  - type: textarea
    id: test_steps
    attributes:
      label: Test Steps
      description: |
        Write each step clearly. Add a checkbox line for the expected result after each step.
        The executor will check these boxes when running the test.
      value: |
        **Step 1:** [Describe the action]
        - [ ] **Expected Result:** [What should happen]

        **Step 2:** [Describe the action]
        - [ ] **Expected Result:** [What should happen]

        **Step 3:** [Describe the action]
        - [ ] **Expected Result:** [What should happen]
    validations:
      required: true

  - type: markdown
    attributes:
      value: "---"

  # ── Section 6: Execution & bug acknowledgment ──────────────────────────────
  - type: dropdown
    id: execution_status
    attributes:
      label: Test Execution Status
      description: "To be set by the tester who executes this test. Authors should leave this as 'Not run'."
      options:
${executionStatusOptions}
    validations:
      required: true

  - type: checkboxes
    id: bug_found
    attributes:
      label: Bug Discovery Acknowledgement
      options:
        - label: "A bug was found during this test. I have logged it as a separate GitHub issue and will link it below."

  - type: input
    id: related_bug
    attributes:
      label: Related Bug Issue
      description: "If a bug was found, link the bug issue here."
      placeholder: "#123 or full GitHub issue URL"

  # ── Section 7: Quality check ───────────────────────────────────────────────
  - type: checkboxes
    id: quality_check
    attributes:
      label: Final Quality Check
      description: "Both items must be confirmed before submitting."
      options:
        - label: "I verified the test case steps are clear and repeatable."
          required: true
        - label: "I selected the correct Epic and User Story."
          required: true
`;

// ── Write output ─────────────────────────────────────────────────────────────
const outDir = resolve(root, ".github/ISSUE_TEMPLATE");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "test_case.yml");
writeFileSync(outPath, yaml, "utf8");

console.log(`✓ Generated: .github/ISSUE_TEMPLATE/test_case.yml`);
console.log(`  Epics:       ${config.epics.length}`);
console.log(`  User Stories:${config.userStories.length}`);