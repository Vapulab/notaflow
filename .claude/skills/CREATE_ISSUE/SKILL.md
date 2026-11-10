---
name: create-issue
description: Create a GitHub issue in Vapulab/notaflow with the issue type, label, assignee and a card on the Vapulab project board (#2). Use for a new bug, feature, task, spike, tech debt or docs item. Never for a security vulnerability (the repo is public).
argument-hint: '[type: bug|feature|task|spike|tech-debt|docs|umbrella] [title]'
---

# Create GitHub Issue

> **Writing style.** The issue text follows root `AGENTS.md` rule 6 and [`WRITING_STYLE.md`](../../../docs/ENGINEERING/CONVENTIONS/WRITING_STYLE.md): English, inverted pyramid, Simplified Technical English, no em dash. Portuguese is fine only inside quotes of UI strings, laws or customer messages.

Create a tracked issue in `Vapulab/notaflow`, set its issue type, label and assignee, and put it on the [Vapulab board](https://github.com/orgs/Vapulab/projects/2) with a Status.

## Workflow

1. **Get the type and title** from `$ARGUMENTS`, or ask the user.
2. **Look for a duplicate** first: `gh issue list --repo Vapulab/notaflow --state all --search "<keywords>"`. If one exists, comment there instead.
3. **Pick the type, label and body** from the table below.
4. **Ask the user** only for content you cannot get from the conversation, the code or production data.
5. **Write the body** to the scratchpad, run the privacy check, and create the issue with `gh issue create`.
6. **Put it on the board** with the correct Status.
7. **Give the user** the issue number and URL, read from the `gh` output. Never guess a number.

## Types

| Argument    | Issue type | Label           | Body sections                        |
| ----------- | ---------- | --------------- | ------------------------------------ |
| `bug`       | `Bug`      | `bug`           | Problem, Steps, Expected, Acceptance |
| `feature`   | `Feature`  | `enhancement`   | Problem, Proposal, Acceptance        |
| `task`      | `Task`     | none            | Goal, To do, Acceptance              |
| `spike`     | `Task`     | `question`      | Question, What to try, Output        |
| `tech-debt` | `Task`     | none            | Problem, Proposal, Acceptance        |
| `docs`      | `Task`     | `documentation` | What is missing, Where it goes       |
| `umbrella`  | `Task`     | none            | Goal, Tracked items (`- [ ] #N`)     |

Add `accessibility` or `dependencies` too when they apply.

The title is a plain sentence that says the problem or the result, with no emoji, no `[TYPE]` prefix and no `type(scope):` form (that form is for PRs and commits). Examples: `Tell the user when a code login erased the password of an unconfirmed account`, `NT 009: the IBS/CBS group on domestic invoices before 2026-12-01`.

Customer bugs from the in-app "Reportar problema" form already become a `Bug` issue, a Notion card and a Discord message by themselves (`apps/server/src/bugs/`). Do not open a second issue for one of them: comment on the existing issue.

## The repo is public

Everything in an issue is public. Before `gh issue create`, read the body again and remove:

- Real e-mails, names, CPF, CNPJ, company names, invoice numbers and access keys of customers. Use a role ("an accounting office", "a client company") or mask them (`lin***@example.com`).
- Tokens, secrets, certificate data, internal hostnames and `.env` values. See [Secrets](../../../docs/ENGINEERING/CONVENTIONS/SECRETS.md).
- Screenshots that show customer data.

**A security vulnerability never goes into an issue.** Open a private advisory at <https://github.com/Vapulab/notaflow/security/advisories/new> (or `gh api repos/Vapulab/notaflow/security-advisories`), and tell the user.

## Body

Lead with one sentence that says the problem or the ask. Then the sections from the table. Keep the evidence (dates, counts, log lines, links to PRs) short and under the section it supports. End with a `- [ ]` list of acceptance criteria that a reviewer can check.

```markdown
## Problem

<One sentence: what is wrong, for whom.> <Why it matters, with numbers if you have them.>

## Proposal

1. <Step>
2. <Step>

## Acceptance

- [ ] <A test or a check that proves it is done>
- [ ] <The case that must not change>
```

## Creating the issue

```bash
unset GH_TOKEN
gh issue create --repo Vapulab/notaflow \
  --title "<title>" \
  --body-file <scratchpad>/issue.md \
  --type Feature \
  --label enhancement \
  --assignee darkanum
```

- `--type` takes the org issue type by name: `Task`, `Bug` or `Feature`.
- Set the assignee at creation, never after. The default is `darkanum` (Lincoln) unless the user names somebody.
- Write the body to the scratchpad and pass `--body-file`; do not inline a long body.
- No AI attribution in the title or the body (root `AGENTS.md` rule 7).

## Adding to the project board

```bash
unset GH_TOKEN
ISSUE_NODE_ID=$(gh issue view <number> --repo Vapulab/notaflow --json id -q .id)

PROJECT="PVT_kwDOFIePls4Bnnv0"
FIELD="PVTSSF_lADOFIePls4Bnnv0zhmLeVc"   # Status
OPT="f75ad846"                          # Todo

ITEM=$(gh api graphql -f query='mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}' \
  -f p="$PROJECT" -f c="$ISSUE_NODE_ID" --jq '.data.addProjectV2ItemById.item.id')

gh api graphql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}' \
  -f p="$PROJECT" -f i="$ITEM" -f f="$FIELD" -f o="$OPT"
```

Gotchas:

- Pass the option as `-f o="$OPT"`: `-o` collides with a `gh` flag.
- `addProjectV2ItemById` is idempotent, so you can run it again if a later step fails.
- The board is an org project, so it also takes issues from `Vapulab/malphas` and `Vapulab/vapulab`.
- `gh` needs the `project` scope to write board fields.

## Project board field IDs

- **Project**: `PVT_kwDOFIePls4Bnnv0` ([Vapulab, board #2](https://github.com/orgs/Vapulab/projects/2))
- **Status** `PVTSSF_lADOFIePls4Bnnv0zhmLeVc`: Todo `f75ad846` · In progress `47fc9ee4` · Done `98236657`
- **Size** `PVTSSF_lADOFIePls4Bnnv0zhmLem4`: XS `c22092d5` · S `2aef0280` · M `d9e61662` · L `db905a7f` · XL `ace80a01`
- **Prioridade** `PVTSSF_lADOFIePls4Bnnv0zhmNk1U`: P0 `2c2ca80e` · P1 `9e8c2cb8` · P2 `53f0b47e`

Set Size and Prioridade only when the user gives them; they use the same `updateProjectV2ItemFieldValue` call with their own field id.

**Check the ids before a batch**, because option ids change when somebody renames a column:

```bash
gh api graphql -f query='query{node(id:"PVT_kwDOFIePls4Bnnv0"){... on ProjectV2{fields(first:30){nodes{... on ProjectV2SingleSelectField{id name options{id name}}}}}}}'
```

## Notes

- Default Status: **Todo**. Use **In progress** only when somebody works on it now.
- A PR that fixes the issue says `Closes #N` in its body, so the issue closes on merge to `production`.
- Issues that wait for an outside answer (an accountant, a partner) say who must answer in the first line.
