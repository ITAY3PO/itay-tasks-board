# Itay's task board

A read-only, monday.com-style board for one person's tasks. This repository is the **public website only**. It ships HTML, CSS, and JavaScript. It does not contain real tasks.

GitHub Pages serves it from the `main` branch root: `index.html`, `styles.css`, and `app.js`. There is no build step.

## Privacy model

Real tasks live in a separate **private** repository, [`ITAY3PO/itay-tasks`](https://github.com/ITAY3PO/itay-tasks), as `tasks.json` on `main`.

This site never embeds that file. On each visit the browser asks the GitHub API for it:

`GET https://api.github.com/repos/ITAY3PO/itay-tasks/contents/tasks.json`

The request sends `Authorization: Bearer <token>`, `Accept: application/vnd.github.raw+json`, and `X-GitHub-Api-Version: 2022-11-28`, with `cache: 'no-store'`. The token is a fine-grained personal access token that you paste once. It is stored in `localStorage` on that browser and is sent only to `api.github.com`. It is not written to this repo. **Forget token** deletes it.

`tasks.json` is also listed in `.gitignore` so a local copy of the private file is harder to commit by mistake.

Anyone who can open DevTools on a signed-in browser can read the token. Use a token whose only repository access is `itay-tasks` and whose only repository permission is Contents: Read-only. Do not reuse it on a shared computer.

## Preview without a token

Open the site with `?demo=1`. That loads `demo-tasks.json` from this repo. Every task in that file is fictional. It exists so the layout can be reviewed on the public site.

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

The board is read-only. Edit tasks by changing `tasks.json` in the private repository, then press **Refresh**. The "Last updated" line reads the file's top-level `updated` field.

A `401`, `403`, or `404` from GitHub is shown as "Token invalid or lacks access", with a way to paste a different token. GitHub also uses `404` when a token cannot see a private repository.

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

- `tldr`: short string. The manager view uses it, and falls back to the first sentence of `notes`.
- `linear`: array of `{ id, url? }`. A missing `url` becomes `https://linear.app/issue/<id>`. Ids shaped like `SOLV-1687` in the title, notes, or source are linked the same way.
- `scheduled`: `{ start, end }` ISO datetimes. A slot that falls today is pinned on the daily agenda.

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

Table and Kanban stay as they were. **Manager** is a third view: compact rows (name, TLDR, due, priority, project, Linear chips) grouped by project. Project groups are collapsible, follow the `projects` array, and show a count. Done tasks are hidden until **Hide done** is turned off. The table and Kanban can group by project the same way.

**Daily agenda** places open tasks into the remaining workday. Each task is 30 minutes, ordered by the `priorities` array, then due date, then `created`. Busy time and pinned `scheduled` slots are skipped. Anything left over is listed under "Didn't fit today". **Copy agenda** puts that plan on the clipboard as plain text.

`demo-tasks.json` and `demo-calendar.json` are fictional. Dates anchored on 2026-10-25 are shifted to the current Asia/Jerusalem day when you open `?demo=1`, so the sample meetings stay on "today".

Filters (project, status, priority, hide done, and text search) are kept in the URL and in `localStorage`. Hebrew task text uses `dir="auto"` so it lays out correctly inside the English UI.

## Tests

Scheduling is a pure function in `schedule.js`. From this directory:

```bash
node --test
```

There is no site build step. GitHub Pages still serves the root files as-is.
