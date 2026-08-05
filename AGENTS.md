<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

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

### 3. Top-Layer UI (Modals & Popovers)
* **One modal primitive:** Every modal or centered popup MUST use the shared **`NativeDialog`** component (`src/components/ui/NativeDialog.jsx`, `<dialog>.showModal()`). Never hand-roll `<dialog>` elements, overlay `<div>`s, or add third-party modal libraries.
* **Anchored, non-modal UI** (menus, dropdowns, tooltips) uses **`NativePopover`** (`src/components/ui/NativePopover.jsx`). Popover backdrops can never block clicks by spec — if the UI must block the page behind it, it is a modal: use `NativeDialog`.
* **Chrome via className:** The primitives handle centering, animation, backdrop, and modality only. Size, padding, background, and radius come from the consumer's SCSS module — style the open state as `&[open] { display: flex }`, never a bare `display` on the closed dialog.
* **Nesting gotcha:** React's synthetic `close`/`cancel` events propagate up the component tree (native ones don't bubble). A `NativeDialog` rendered inside another MUST call `event.stopPropagation()` in its own `onClose`/`onCancel`, or closing it also closes the parent.

### 4. Smart Contracts (Solidity)
* **Organization:** Structure contract files layout cleanly using designated section dividers:
    ```solidity
    // --- Storage ---
    // --- Events ---
    // --- Modifiers ---
    // --- Logic ---
    ```

### 5. Terminology
* **"onchain", never "on-chain":** Always write **onchain** (one word, no hyphen) in all code, comments, UI copy, and documentation. Apply the same to "offchain".

### 6. Git & Internationalization
* **Commits:** Prefix all architectural or structural intentions with Conventional Commit standards (`feat:`, `fix:`, `chore:`, `refactor:`).
* **Data Formatting:** Use native JavaScript **`Intl`** utilities for compact ticker numbers and localized relative time strings.
* **String Normalization:** Ensure slug/URL generation processes properly preserve and normalize Unicode characters, including Zero Width Non-Joiners (ZWNJ).