# Itay's task board

A read-only, monday.com-style board for one person's tasks. This repository is the **public website only**. It ships HTML, CSS, and JavaScript. It does not contain real tasks.

GitHub Pages serves it from the `main` branch root: `index.html`, `styles.css`, and `app.js`. There is no build step.

## Privacy model

Real tasks live in a separate **private** repository, [`ITAY3PO/itay-tasks`](https://github.com/ITAY3PO/itay-tasks), as `tasks.json` on `main`.

This site never embeds that file. On each visit the browser asks the GitHub API for it:

`GET https://api.github.com/repos/ITAY3PO/itay-tasks/contents/tasks.json`

The request sends `Authorization: Bearer <token>`, `Accept: application/vnd.github.raw+json`, and `X-GitHub-Api-Version: 2022-11-28`, with `cache: 'no-store'`. The token is a fine-grained personal access token that you paste once. It is stored in `localStorage` on that browser and is sent only to `api.github.com`. It is not written to this repo. **Forget token** deletes it.

That token is for reading. Editing uses a second token, described in [Connect for editing](#connect-for-editing). A read-only token cannot save. If a write token is saved and no read token is, the board may use the write token to load tasks as well. The read request itself does not change.

`tasks.json` is also listed in `.gitignore` so a local copy of the private file is harder to commit by mistake.

Anyone who can open DevTools on a signed-in browser can read the token. Use a token whose only repository access is `itay-tasks` and whose only repository permission is Contents: Read-only. Do not reuse it on a shared computer.

## Preview without a token

Open the site with `?demo=1`. That loads `demo-tasks.json` from this repo. Every task in that file is fictional. It exists so the layout can be reviewed on the public site. Demo mode can edit, drag, and create tasks in memory. Those edits are not written to GitHub and disappear on refresh.

Leaving demo (or opening the site with no `demo` parameter and no saved token) shows the token setup screen.

## Enable GitHub Pages

1. Open this repository's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose branch **`main`** and folder **`/ (root)`**.
4. Save.

GitHub prints the site URL on that page. For this repo it is typically:

`https://itay3po.github.io/itay-tasks-board/`

Add `?demo=1` to that URL to see the fictional board. The first deploy can take a minute.

## Token setup

The setup screen walks through the same three steps:

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new).
2. Set the resource owner to **ITAY3PO**. Choose **Only select repositories** and select **itay-tasks**.
3. Set repository permission **Contents** to **Read-only**. Generate the token and paste it into the board.

Without a write token the board stays read-only: drag handles, the move menu, and the task editor stay hidden, and the page says to connect for editing. With a write token, or in demo mode, you can change tasks on the board. The "Last updated" line reads the file's top-level `updated` field. **Refresh** reloads the file.

A `401`, `403`, or `404` from GitHub is shown as "Token invalid or lacks access", with a way to paste a different token. GitHub also uses `404` when a token cannot see a private repository.

## Connect for editing

Editing is off until you paste a write token in **Connect for editing**. **Disconnect** in that dialog deletes it from this browser. The token is stored only in `localStorage` under a separate key from the read token. It is sent only to `api.github.com`. It is not committed to this repo, not built into the page, not written into the URL, and not shown again after you save it.

Create it from [Fine-grained personal access tokens](https://github.com/settings/personal-access-tokens/new):

1. Token type: **fine-grained personal access token**.
2. Resource owner: **ITAY3PO**.
3. Repository access: **Only select repositories**, and select **itay-tasks**.
4. Repository permissions: **Contents: Read and write**. Metadata read is included automatically. Do not grant any other permission.
5. Expiration: **30 days** is a good default. Prefer 90 days or less, and do not use this token on a shared computer.

Each save is committed to `tasks.json` on `main` in `ITAY3PO/itay-tasks` through the GitHub Contents API. Dragging a card between Eisenhower quadrants sets that task's `quadrant` (`Q1`–`Q4`) or removes it for Unsorted. Dragging between Kanban status columns sets `status`. A **Move** menu on the card does the same thing from the keyboard. The task form edits title, notes, due, status, quadrant, project, and parent, and can create the next free id (`tNNN`) or a subtask of the open task.

The board checks the same rules as the data repo before it writes: field types and enums, unique ids, a project from the file's `projects` list, a parent that exists, no self-parent, and no parent cycle. The write is a patch for that one task on the latest file text, so indentation, key order, and the trailing newline stay as they are. If GitHub returns a 409 or 422 because the file changed, the board loads the file again, reapplies the same task patch, and retries up to three times. It does not replace the file with a stale copy. The commit message looks like `board: t034 quadrant Q2 -> Q1`. The header shows Saving, Saved, or a failure. A failure puts the task back and explains why.

## Local preview

From this directory:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/?demo=1`. Fetching `demo-tasks.json` needs a local server; opening `index.html` as a file usually blocks it.

## Data shape

`tasks.json` is a JSON object:

- `updated`: timestamp string
- `projects`: array of names. The current list is Moon Active, Travel Town, UMI, and Personal.
- `statuses`: `todo`, `in_progress`, `waiting`, `done`
- `priorities`: `urgent`, `high`, `medium`, `low`
- `tasks`: array of `{ id, title, status, priority, due, project, waiting_on, source, notes, created, updated }`

`due` is `YYYY-MM-DD` or `null`. `waiting_on` is a string or `null`. Missing or unknown fields are shown neutrally; they do not break the page.

Optional per-task fields may be missing on any task:

- `tldr`: short string. The manager view and the Eisenhower cards use it, and fall back to the first sentence of `notes`.
- `linear`: array of `{ id, url? }`. A missing `url` becomes `https://linear.app/issue/<id>`. Ids shaped like `SOLV-1687` in the title, notes, or source are linked the same way.
- `scheduled`: `{ start, end }` ISO datetimes. A slot that falls today is pinned on the daily agenda.
- `quadrant`: `Q1`, `Q2`, `Q3`, or `Q4`. Missing means Unsorted. Q1 is Do (urgent and important), Q2 is Schedule (important, not urgent), Q3 is Delegate (urgent, not important), and Q4 is Drop (neither). `priority` is unchanged.
- `parent`: id of another task, for example `t071`. When that id matches a task in the file, this task is a subtask of it. A missing value, a blank value, or an id that is not in the file leaves the task as a top-level task.

An optional `calendar.json` may sit next to `tasks.json`:

```json
{
  "date": "2026-10-25",
  "timezone": "Asia/Jerusalem",
  "workday": { "start": "09:00", "end": "19:00" },
  "busy": [{ "start": "2026-10-25T10:00:00+02:00", "end": "2026-10-25T10:45:00+02:00", "title": "Standup" }],
  "updated": "2026-10-25T06:30:00Z"
}
```

The board fetches it with the same read-only token. A missing file or a `404` is normal. If the file is missing or its `date` is not today in that timezone, the agenda says "Calendar not loaded, meetings not excluded" and still builds a schedule. With no calendar, the workday is 09:00–19:00 Asia/Jerusalem, Sunday through Thursday. Friday and Saturday show "Not a workday" and can still be scheduled. A calendar dated today can replace the workday hours and contributes busy blocks, which the agenda shows as meetings.

Every entry in `busy` is treated as busy, including pending or tentative invites that were already written into that list. A block that starts before the workday or runs past it is clipped to the workday (an 08:00 start becomes 09:00 when the workday starts then). `title` may be any string; the agenda shows it as a single line of text.

## Views

Table and Kanban stay as they were. **Manager** is a third view: compact rows (name, TLDR, due, priority, project, Linear chips) grouped by project, with a quadrant badge such as "Q1 Do". Project groups are collapsible, follow the `projects` array, and show a count. Done tasks are hidden until **Hide done** is turned off. The table and Kanban can group by project the same way. The table has a Quadrant column, and every column header sorts its group.

**Eisenhower** is a fourth view. It is a 2×2 grid: Q1 Do, Q2 Schedule, Q3 Delegate, and Q4 Drop. Each cell has a short subtitle, a count, and task cards. Tasks with no quadrant sit in an Unsorted strip under the grid. On a narrow screen the cells stack in that order. The same filters, including quadrant, and **Hide done** apply.

On Eisenhower and on Kanban grouped by status, a connected board (or demo mode) can drag a card onto another quadrant or status column. Touch uses the same drag handle as the mouse. **Move** opens the same choices from the keyboard. Other views change status and quadrant from the task form.

Subtasks indent under their parent in the Table, Kanban, and Manager views. The parent shows a small `done/total` count for its direct subtasks, such as `3/12`. Each nested subtask shows its own status, with a read-only check when that status is done. Each subtask has a Parent chip that opens the parent. A subtask whose parent is hidden by the current filters stays in its own group, as a normal task, and still shows that chip. Eisenhower and the daily agenda keep listing subtasks as normal tasks in their quadrant or time slot, with the same Parent chip. A task with no parent, or with a parent id that is not in the file, is unchanged.

**Daily agenda** places open tasks into the remaining workday. Each task is 30 minutes. Candidates are ordered Q1, then Q2, then Q3, then tasks with no quadrant. Inside each group the order is the `priorities` array, then due date (earlier first, no date last), then `created`. Q4 tasks are left out. Busy time and pinned `scheduled` slots are skipped. Anything left over is listed under "Didn't fit today". **Copy agenda** puts that plan on the clipboard as plain text.

`demo-tasks.json` and `demo-calendar.json` are fictional. Dates anchored on 2026-10-25 are shifted to the current Asia/Jerusalem day when you open `?demo=1`, so the sample meetings stay on "today".

Filters (project, status, priority, quadrant, hide done, and text search) are kept in the URL and in `localStorage`. Hebrew task text uses `dir="auto"` so it lays out correctly inside the English UI.

## Tests

Scheduling is a pure function in `schedule.js`. From this directory:

```bash
node --test
```

There is no site build step. GitHub Pages still serves the root files as-is.
