# ADR 0010: Compatibility remediation and evidence lifecycle

## Status

Accepted for M31.

## Context

M30 introduced explainable compatibility assessments, but static imports still appeared as if they were waiting for a user confirmation. Suggested actions were mostly prose, the structured editor did not cover the full capability contract, and archived Components could not be restored through GUI/CLI/Core. A user edit could also submit validation/evidence fields even though human confirmation cannot prove platform, entrypoint, capability, Adapter or runtime compatibility.

Pi + MRAgent exposed the ambiguity: safe static inspection identified both as execution controllers with unknown replaceability and no Runtime Adapter. Treating a Descriptor correction as Native or runtime verified would fabricate evidence; the product instead needs an auditable path that makes Pi the execution Owner and corrects MRAgent to memory/state-store only when source evidence supports that role.

## Decision

Compatibility is an evidence pipeline with three system authorities:

1. deterministic safe static inspection may write manifest/static evidence but never execute imported code;
2. deterministic contract tests may write contract-test Receipts and Artifact hashes after schema, capability, dependency, replaceability, activation and entry checks;
3. trusted minimal runtime validation may write runtime-check evidence only after a contract test and an exact built-in Adapter allowlist match.

Native, Configuration, Adapter, Fork and Incompatible are disposition strategies and human audit choices. They never raise validation. Descriptor mutation preserves system-owned validation/evidence, and a technical-contract change marks active contract/runtime evidence as superseded before returning to declared. Legacy user-confirmed evidence remains visible as a human decision and never contributes technical uplift.

Every assessment action has a presentation contract: an allowlisted button, a structured form or a written external step. Renderer does not interpret arbitrary commands. The complete form edits platforms, provides/requires, replaceability, activation, configuration, Runtime Adapter reference, minimum permissions, Keychain reference names and strategy. Core performs strict schema validation, revision conflict protection and audit writes; Cancel performs no mutation.

Trusted validation forks a fixed application-owned entry. The child receives identifiers and a whitelisted Adapter reference only, starts a fresh Cordis kernel with an application-owned lifecycle Adapter, validates start/stop/cleanup, and returns a strict redacted Receipt. stdout/stderr is discarded. Abort and timeout use cooperative cancellation followed by bounded forced cleanup. Unknown local code, scripts, hooks, binaries and dependencies are never imported or run.

Component lifecycle gains active/archived/all filtering and restore through Core, CLI, schema-validated IPC, Preload and Renderer. Restore clears `archivedAt`, appends audit evidence and immediately returns the Component to the Agent picker. Permanent deletion still requires archival and remains protected by Stack, Workflow and immutable Version references.

## Portable data and migration

M31 is additive within `.agent-stack` v2: permission and Keychain-reference declarations, strategy rationale/time, richer evidence metadata and optional audit entries remain portable facts. SQLite receives no duplicate tables or synchronization logic. Existing v0/v1 migration retains backups. Existing v2 unknown/user-confirmed records are read through an explicit idempotent mapping without rewriting their evidence; formats newer than v2 remain downgrade-rejected.

## Consequences

- Users see what machine evidence is absent instead of a misleading confirmation prompt.
- Strategy selection and Descriptor editing cannot forge technical validation.
- Contract changes retain historical evidence while making its loss of currency visible.
- GUI and CLI share the same lifecycle and validation authority.
- Runtime trust remains exact and application-owned; Cordis stays inside the Runtime boundary.
