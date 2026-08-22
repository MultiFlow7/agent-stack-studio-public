# ADR 0009: Agent-first project integration and one portable truth

## Status

Accepted for M30.

## Context

Before M30 the product exposed two writable composition paths:

```text
Studio Project GUI / studio CLI
  -> Studio Core -> .agent-stack

Agent Stack GUI
  -> ComponentService -> ComponentRepository
  -> SQLite components / agent_stack_components / capability_owners / agent_versions
```

The component-library import path wrote only `.agent-stack`, while the Agent component picker read only SQLite. The same Component, Stack, Owner and Version concepts therefore appeared in two interfaces and could diverge. Saving Descriptor JSON also changed evidence to `user-confirmed`, conflating a data edit with a human trust or permission decision.

The complete former read/write entry points were:

- Core/CLI/project IPC: project init/open/inspect/export, component import/update/descriptor/archive/delete, stack add/remove/owner, workflow edits and freeze, project version freeze;
- Main SQLite services/agent IPC: Agent create/import/update/duplicate/archive/delete/version, component catalog/list, Stack add/remove/owner;
- downstream readers: Run, Experiment, Publish, command center, component detail and Agent status.

## Decision

One opened `.agent-stack` project represents one portable Agent Stack. It is the only portable source for Component Descriptor and source snapshots, available components, Stack order/membership, capability Owner decisions, compatibility inputs/conclusions, Workflow DAGs and immutable Agent/Workflow Versions.

The application information architecture is Agent-first:

1. import or update components in Component Library;
2. select, order and combine them in the Agent Stack view;
3. review system compatibility evidence, blockers and suggested actions, and make only trust/permission/Owner/legal/business decisions;
4. freeze an immutable Agent Version;
5. Run, Experiment or Publish that Version.

“Studio Project” is removed from primary navigation. The top bar is the global current-project context. Project Settings contains only project switching, path, revision, integrity/recovery, import/export and the packaged CLI path. It does not edit Component, Stack, Owner, Workflow or Descriptor JSON.

SQLite v9 adds `agent_project_links`. Local Agent identities reference a stable project ID/path and project Version ID; Runs, Experiments, Receipts, Artifacts, local status and Keychain references remain local. New Version rows store only a project reference. Publish materializes the immutable project snapshot in memory and never copies it back into SQLite.

GUI and CLI continue to share Studio Core. Renderer has no Node, filesystem, database or secret access; all Main calls remain schema-validated and allowlisted. Cordis stays inside a new Runtime child process. Static inspection never executes imported code.

Compatibility uses a shared, explainable assessment with the user-facing states unchecked, static inspection complete but machine evidence required, static passed, configuration required, Adapter required, runtime verified and incompatible. `unchecked` is reserved for components with no static-inspection record; completing a safe scan changes the workflow state without upgrading validation evidence. Each result contains evidence, blockers, suggested actions, time and method. Descriptor editing preserves its evidence level. Only explicit trust, permission or Owner decisions may create human audit records.

## Migration

At startup, every unlinked legacy SQLite Agent is migrated idempotently:

1. resolve all legacy Component and Version references;
2. construct and validate a v2 `.agent-stack` without executing source code;
3. atomically write it and retain `.agent-stack.migration-backup`;
4. in one SQLite transaction, add the local project link, replace Version snapshots with stable project references and remove legacy Stack/Owner rows;
5. clear the legacy global Component table only after all Agents are linked.

An existing different project, a missing historical Component, mixed reference formats or any write failure stops migration without overwriting the conflict. A file written before a database failure is safe to reuse on retry. Newer database/project formats remain downgrade-rejected.

## Consequences

- A component imported in Component Library is immediately selectable in the current Agent.
- External CLI edits and GUI edits converge through one revision and conflict mechanism.
- Historical Run/Experiment/Receipt foreign keys remain stable because Version IDs are preserved.
- Project-backed Agent duplication is performed through portable export/import, never by cloning an SQLite Stack.
- Legacy SQLite portable tables remain only as migration scaffolding; normal M30 reads and writes do not use them for a project Agent.
