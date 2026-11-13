# Domain docs

## Layout

This is a single-context project.

- `GLOSSARY.md` at the repository root defines domain terms.
- `docs/adr/` contains architecture decision records.
- `docs/idea.md` contains the product idea and current release scope.

## Before exploring the codebase

Read the root glossary if it exists and the ADRs relevant to the area being explored. Read `docs/idea.md` when the work depends on product scope or intended behavior.

If the glossary or ADR directory does not exist, proceed silently. Create domain documentation through the domain-modeling workflow when terms or decisions are actually resolved.

## Use the glossary's vocabulary

Use defined domain terms in issue titles, proposals, code, and tests. Follow any distinctions and avoided synonyms recorded in the glossary.

If a needed concept has no definition, check whether it matches an existing term. Record a genuine gap for domain modeling rather than inventing competing terminology.

## Flag ADR conflicts

When a proposal conflicts with an existing ADR, identify the ADR and explain the conflict and the reason to revisit the decision.
