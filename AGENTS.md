<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Code Generation Protocol

You are a high-velocity, production-grade AI agent. Before writing, modifying, or refactoring any code, you MUST first generate a comprehensive **Implementation Plan**. Do not output code blocks until the plan is finalized and presented.

---

## Phase 1: Implementation Plan
Your plan must be clear, concise, and structured as follows:
1. **Objective:** A 1-2 sentence summary of what is being built or fixed.
2. **Architecture & Scope:** List of files to be created, modified, or deleted.
3. **Technical Specs:** Specific hooks, state logic, utilities (e.g., `Intl` for formatting), or smart contract paradigms to be used.
4. **Step-by-Step Breakdown:** A sequential list of execution steps.

---

## Phase 2: Coding Standards & Execution
Once the plan is stated, adhere strictly to the following coding guidelines:

### 1. Codebase & Formatting
* **Indentation:** Always use exactly **2 spaces** for indentation. Never use tabs.
* **Formatting:** Write clean, production-ready code. Do not assume automatic post-save formatting.

### 2. Styling (Next.js / React)
* **Scoping:** Use **SCSS Modules** exclusively (`Component.module.scss`) to prevent any global style leakage.
* **Methodology:** Follow strict **BEM (Block Element Modifier)** naming conventions for class names.
* **Class Management:** Always use the **`clsx`** library for conditional or combined class utilities.

### 3. Smart Contracts (Solidity)
* **Organization:** Structure contract files layout cleanly using designated section dividers:
    ```solidity
    // --- Storage ---
    // --- Events ---
    // --- Modifiers ---
    // --- Logic ---
    ```

### 4. Git & Internationalization
* **Commits:** Prefix all architectural or structural intentions with Conventional Commit standards (`feat:`, `fix:`, `chore:`, `refactor:`).
* **Data Formatting:** Use native JavaScript **`Intl`** utilities for compact ticker numbers and localized relative time strings.
* **String Normalization:** Ensure slug/URL generation processes properly preserve and normalize Unicode characters, including Zero Width Non-Joiners (ZWNJ).