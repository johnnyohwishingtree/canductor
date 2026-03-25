# Reflections

## #167 — 2026-03-24T17:55:00Z

### [module] packages/core/src/reflections.ts
**Followed:** .canductor/templates/module.md
**Covered:** module structure (imports, constants, public API, internal helpers), JSDoc on exports, barrel re-export reminder, ESM .js extensions
**Missing from template:** how to parse structured markdown (the module reads reflections.md which has a specific format with ## and ### headers). Template covers generic modules but nothing about parsing markdown with regex patterns.
**Found elsewhere:** looked at packages/core/src/learnings.ts which does similar markdown parsing with regex. Used the same split-on-header pattern.
**Issues during verify:** none

### [test] packages/core/__tests__/reflections.test.ts
**Followed:** .canductor/templates/test.md
**Covered:** test structure (describe/it/expect), temp directory pattern (mkdtempSync + rmSync), fixture setup
**Missing from template:** no guidance on testing markdown parsers specifically — how to structure test fixtures for multi-block markdown content. Used inline string constants which works but the template could mention this pattern for parser tests.
**Found elsewhere:** looked at packages/core/__tests__/learnings.test.ts for the writeFileSync-in-tempDir pattern for markdown test data
**Issues during verify:** none

### [new-cli-command] add reflections command to CLI
**Followed:** .canductor/patterns/new-cli-command.md
**Covered:** file placement (commands/analytics-diagnostics.ts), registry pattern (commands/index.ts Map), usage banner update, separation of core logic from CLI handler
**Missing from template:** No gaps — the pattern was thorough. It specified which command module to use, the registry pattern, and the usage banner location.
**Found elsewhere:** none needed
**Issues during verify:** none

