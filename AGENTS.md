## Environment variables

- Add an environment variable only when implemented code or the current deployment needs it. Identify its consumer and use ordinary configuration for fixed, non-secret constants.
- Keep environment examples, validation schemas, and required-variable checks limited to variables currently consumed. Add variables for future features when those features are implemented.
- Scope variables and validation to the app or service that consumes them. Optional integrations must not make unrelated apps, builds, or commands require their configuration.

## Agent skills

### Issue tracker

Work is tracked in GitHub Issues for `Tauqeer-Ahmed-99/hajj-and-umrah-travel-checklist`. Before reading, creating, or updating issues or specs, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. Before triaging, read `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context project with a root `GLOSSARY.md` and `docs/adr/`. Before exploring the codebase, read `docs/agents/domain.md`.
