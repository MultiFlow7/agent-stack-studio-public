# Agent Stack Studio UI foundation

## Design read

Agent Stack Studio is a macOS research tool for people who need trustworthy structure and evidence. The interface is intentionally quiet, information-led, and close to a native desktop utility rather than a marketing dashboard.

Design dials: variance 5, motion 3, density 5.

## Tokens

- Typography: the macOS system sans stack for native legibility; SF Mono fallback for identifiers.
- Accent: indigo-blue, used only for primary actions, focus, and the active destination.
- Neutrals: cool gray surfaces with a single light theme for M0.
- Shape: 10px controls, 14px major surfaces, full circles only for icon buttons.
- Motion: 160ms feedback transitions; all non-essential transitions are removed under `prefers-reduced-motion`.
- Focus: a high-contrast 3px outline with 2px separation.

All body text and controls target WCAG 2.2 AA. State is communicated by text and icons, never color alone.

## Remote discovery pattern

Remote candidates use one continuous bordered list with compact metadata, not a card wall. A blue-tinted boundary label distinguishes read-only public metadata from local project facts. Download handoff expands inline beneath results and always shows review-required command text; there is no automatic execution affordance. Loading preserves the result footprint with skeletons, while cancellation, validation, rate limits, timeouts, offline errors, provider failures and empty results each retain a fact-specific recovery action. Local validation returns focus to the query; retryable provider states never imply that a request, result, or download was saved.

## Keychain settings pattern

Secret references use one bordered list followed by an inline metadata form. Each row shows purpose, account, service and a text-plus-icon local status. The secret itself is entered only in the macOS native hidden-input dialog initiated by Main, never in a Renderer field. Destructive removal expands to inline confirmation and cancel controls.

## Local runtime and capability pattern

The Run launcher shows a continuous boundary strip for the selected execution mode: immutable built-in behavior first, then the explicit statement that imported repositories remain static-only. Run facts translate mode and binding into human-readable Chinese while retaining the full Manifest disclosure. The capability page uses one dense bordered list rather than cards; each row pairs a capability with its current Owner and expandable Provider evidence. Ready and blocked states always include text and icons, never color alone.

## Agent status pattern

Agent status remains information-dense and continuous. List rows use aligned fact columns for version/draft, Stack, recent Run and publish state; the overview uses one definition list rather than metric cards. The detail title keeps the Agent name and actions dominant, with a wrapping status summary underneath so long names never collapse status labels into vertical text. Missing facts are stated explicitly instead of showing synthetic activity.

## Component catalog pattern

The catalog uses one filter bar and one horizontally resilient table. Component identity is the keyboard-accessible detail action; the detail expands as a single evidence document with a strong focus outline, two-column fact groups, and continuous capability/evidence/usage lists. Long source and Schema references wrap rather than clipping, while declared-only components explicitly show that no validation record exists.

## Workflow DAG pattern

Workflow editing is a structured, inline desktop form rather than a generic canvas. Each Workflow stays one continuous bordered document: compact identity/actions, optional editor, a horizontally readable node sequence, explicit edge chips, and immutable Version markers. Direct-cycle errors remain above the intact graph with a visible reload path. Node type is always written in text, and deleting draft structure never visually suggests that history was deleted.

## Component remediation pattern

Adapter/Fork remediation is one ordered evidence chain, not a task-dashboard card wall. Each row pairs a text-and-icon state with the Component, stage, explanation, and keyboard-expandable acceptance criteria. Completed contract evidence stays visually distinct from required runtime validation. The boundary statement remains in the section header: Studio does not generate, load, or execute third-party code. Permanent Component deletion expands inline in its existing row, keeping both confirm and cancel beside the affected identity.

## Run history pattern

Historical Run detail is a read-only evidence document. Failure stays prominent, followed by one compact projection that groups the immutable Prompt, seed, timeout, retry/concurrency and wall duration with the linked Experiment Drift result. Standalone Runs explicitly say that Drift is not applicable rather than presenting synthetic success. The event timeline and execution boundary remain below the projection, so users can move from outcome to reproduction facts to low-level evidence without editable controls.

## Experiment matrix pattern

Experiment results remain one continuous evidence surface: progress and the immutable reproduction definition precede the matrix, while filters narrow the same saved cells without changing the experiment. “Terminal” is kept distinct from “succeeded”; failures, cancellations and Drift blocks share a clearly labelled attention filter, and partial completion always keeps the planned denominator visible. The comparison table states its first Prompt/seed baseline and uses a dash when a cancelled or failed combination has no meaningful duration, avoiding synthetic relative metrics.

## Workspace command-center pattern

The topbar is a compact factual instrument strip: the current project and revision anchor the left, local search stays visually central, and Run state plus one create action occupy the right. The command palette is one continuous list rather than a grid of shortcuts. Category labels remain quiet, entity identity stays dominant, and keyboard selection is always visible. Summary errors degrade only the affected topbar control; they never replace the active workspace view.
