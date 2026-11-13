# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `Tauqeer-Ahmed-99/hajj-and-umrah-travel-checklist`. Use the `gh` CLI from this repository.

## Conventions

- Before the first issue write in a session, verify the target with `gh repo view --json nameWithOwner`. Use `--repo Tauqeer-Ahmed-99/hajj-and-umrah-travel-checklist` when needed to target this repository.
- Create an issue with `gh issue create --title "..." --body-file <file>`.
- For multiline bodies and comments, write the exact text to a temporary file and pass `--body-file <file>`.
- Read an issue with `gh issue view <number> --json number,title,body,labels,comments`.
- List issues with `gh issue list --state open --json number,title,body,labels,comments`, adding label and state filters as needed.
- Update an issue body with `gh issue edit <number> --body-file <file>`.
- Comment with `gh issue comment <number> --body-file <file>`.
- Apply or remove labels with `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Before closing an issue, post the explanation as a comment, then run `gh issue close <number>`. Posting separately preserves the explanation even when the issue is already closed.
- File issues into this project's repository. If the resolved target differs, confirm the intended target before creating an issue.

## Parent issues and blockers

Create a child with `gh issue create --parent <parent> ...`, or attach an existing child with `gh issue edit <parent> --add-sub-issue <child>`.

Use GitHub's native dependencies for blocking relationships. Create with `gh issue create --blocked-by <blocker>,<blocker> ...`, or update with `gh issue edit <child> --add-blocked-by <blocker>`.

Count open blockers with `gh api repos/Tauqeer-Ahmed-99/hajj-and-umrah-travel-checklist/issues/<number> --jq .issue_dependencies_summary.blocked_by`. An issue is unblocked when all its blockers are closed.

If native relationships are unavailable, add `Part of #<parent>` and `Blocked by: #<number>, #<number>` near the top of the child body. Keep a task list of children in the parent.

## Skill operations

When a skill says "publish to the issue tracker", create a GitHub issue. When it says "fetch the relevant ticket", read the referenced issue, including its comments and labels.

## Pull requests as a triage surface

PRs as a request surface: no.

## Wayfinding operations

- The map is one issue labeled `wayfinder:map`, containing its notes, decisions, and unresolved questions.
- Each child ticket is a sub-issue of the map, with a `wayfinder:<type>` label. Types are `research`, `prototype`, `grilling`, and `task`.
- If sub-issues are unavailable, use the parent task list and the child's `Part of` line.
- Find available work among the map's open children. Exclude assigned tickets and tickets with open blockers. Use the first remaining ticket in map order.
- Claim a ticket before work with `gh issue edit <number> --add-assignee @me`.
- Resolve a ticket by posting its answer, closing it, and adding a brief finding with a link to the map's decisions.
