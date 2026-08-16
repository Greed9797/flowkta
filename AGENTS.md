# Project Instructions

## Language

Write all project content in Brazilian Portuguese: identifiers, documentation, source comments,
error messages, tests, and commits. This matches the sibling `ops-engine` in the owner's
CreativeOS monorepo, and the operator who reads these errors at 3am reads Portuguese.

The exception is anything that crosses into another tool's vocabulary — gflow flags, Invokta API
names, model ids — which stay verbatim.

## Architecture

- Define domain actions as capabilities with explicit input, output, access, and execution contracts.
- Keep the generated direct, MCP stdio entry points on the single `engine.invoke` path.
- Keep models, prompts, providers, data stores, and tools behind replaceable engine-owned dependencies.
- Keep business logic out of `src/direct.ts`, `src/mcp-stdio.ts`.
- Do not add framework-wide registries, service locators, or adapter-specific business logic.

## Delivery

- Follow RED, GREEN, REFACTOR for executable behavior.
- Run `npm run check` before completing a change.
- Keep `CLAUDE.md` as a symbolic link to this file so agent instructions have one source of truth.
