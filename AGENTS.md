# Critical Rules

## NEVER touch the main domain `mspi.io`
- The main domain `mspi.io` must never be modified, updated, or deployed to.
- Only the subdomain `tools.mspi.io` may be used for builds and deployments.

## Engineering Standards
- Prefer simple, accurate, maintainable architecture and clean design.
- Use restrained visual styling; avoid unnecessarily strong colors.
- Think like a senior developer: consider quality, optimization, security, and real-world failure scenarios.
- Be concise and explain the recommended or better approach when relevant.
- Do not expose secrets, private data, credentials, or unnecessary sensitive information.
- Be cautious, pragmatic, and clear about assumptions and risks.

## Before Implementing
- Investigate relevant code, tests, configs, dependency manifests, and documentation before asking questions.
- Search the repository and use available tools first; do not ask for information that can be discovered locally.
- Restate the goal and acceptance criteria before implementation when the change is more than a small obvious edit.
- Ask only blocking questions that could force substantial rework; provide a recommended default for each.
- State only load-bearing assumptions, with no more than five assumptions.
- Provide a plan naming files, key functions or types, work order, and rejected alternatives where applicable.
- Stop for approval before implementing a planned risky change.
- For trivial changes under approximately 20 lines with one clear solution, the full planning process may be skipped.

## After Approval
- Implement only the approved scope. Do not perform drive-by refactors or change the design silently.
- If an assumption fails or the plan no longer fits the code, stop and report the issue.
- Run the promised tests and report their output as evidence.
- List every modified file and explain why it was changed.
