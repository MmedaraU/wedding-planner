# Wedding Planner — Companion App

A single-page web app that turns a Google Sheet workbook into a mobile-friendly
wedding dashboard. No build step, no backend, no database — static HTML/CSS/JS
on GitHub Pages talking to a Google Apps Script Web App.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [File structure](#file-structure)
4. [First-time setup](#first-time-setup)
5. [Configuration reference](#configuration-reference)
6. [Sheet conventions](#sheet-conventions)
7. [Views and features](#views-and-features)
8. [How the numbers are calculated](#how-the-numbers-are-calculated)
9. [Redeploying after changes](#redeploying-after-changes)
10. [Troubleshooting](#troubleshooting)
11. [Known quirks](#known-quirks)
12. [Local development](#local-development)

---

## What it does

The Google Sheet is the source of truth. Every edit is stored there, so the raw
data survives independently of the app. The web app is a nicer phone-first
interface on top of it.

The app surfaces:

- A **Today** view of overdue tasks, deadlines this week, pending guests, and
  upcoming deposits.
- An **Overview** with a live countdown, key dates, progress bars, and
  editable metadata (couple name, wedding date, venue, etc.).
- A **Team** directory with call/WhatsApp buttons and inline add/edit.
- A **Vendors** pipeline grouped by stage, with inline editing of contact,
  phone, address, city, price, and notes.
- Sheet-backed views for the **Planning Schedule** (timeline), **Bridal List**,
  **Budget**, **Guest List**, **Gifts**, **Cash**, **Rentals**, and the two
  run-lists (*Things to get to and from venue*, *Things to take back to new
  home*).
- Global search across every exposed sheet.

Reads and writes go through the Apps Script Web App. No third-party backend.

---

## Architecture

```
┌────────────────────┐     HTTPS (GET/POST)      ┌────────────────────────┐
│  Browser           │ ────────────────────────▶ │  Apps Script Web App   │
│  GitHub Pages      │                           │  (Google Macros.gs)    │
│  index.html        │ ◀──────────────────────── │  doGet / doPost        │
│  app.js            │          JSON             │                        │
│  styles.css        │                           └───────────┬────────────┘
│  config.js         │                                       │
└────────────────────┘                                       ▼
                                                  ┌────────────────────────┐
                                                  │  Google Sheet          │
                                                  │  (the actual database) │
                                                  │                        │
                                                  │  _app_config           │
                                                  │  _app_meta             │
                                                  │  budget_flat           │
                                                  │  …every other sheet    │
                                                  └────────────────────────┘
```

- **`config.js`** holds the deployed Web App URL and the shared secret.
- **`app.js`** is one file. It fetches the schema on boot, renders views by
  route, and posts writes back through the API. No framework.
- **`Google Macros.txt`** is the Apps Script source. It handles both the
  sheet-side automations (`onEdit`, `onOpen`, scheduled bulk jobs) and the
  Web App API.

Caching is client-side, per sheet, with a 5-minute TTL. A successful write
clears the affected sheet's cache entry. Writes to `_app_meta` and the Team
CRUD endpoints also clear the Overview cache.

---

## File structure

```
.
├── index.html            # Shell: sidebar, view container, toast, modal
├── app.js                # All app logic
├── styles.css            # All styling (single file, mobile-first)
├── config.js             # CONFIG.apiUrl + CONFIG.secret
├── README.md             # This file
└── Google Macros.txt     # Apps Script source — paste into the Sheet's
                          # Extensions ▸ Apps Script editor
```

`config.js` is intentionally excluded from the public repo (add it to
`.gitignore`). Keep it as a local-only file, or accept that anyone viewing
source can see the API secret — the secret only protects against casual
scraping, not determined abuse.

---

## First-time setup

### 1. Prepare the Google Sheet

The workbook should already have:

- **`_app_config`** — one row per sheet the app should expose
- **`_app_meta`** — key/value metadata for the Overview
- **`budget_flat`** — a flat mirror of the Budget sheet (see
  [Sheet conventions](#sheet-conventions))

### 2. Deploy the Apps Script

1. Open the Sheet → **Extensions ▸ Apps Script**.
2. Paste in `Google Macros.txt`.
3. Set `API_SECRET` near the top to a long random string.
4. Run **`installTriggers()`** once to install the 5-minute bulk job.
5. Add an installable `onEdit` trigger for the checkbox formatting.
6. Run **`setupExistingData()`** to insert checkboxes.
7. Reload the Sheet → the **⚙️ Workbook Tools** menu appears.
8. Run **"Run all bulk jobs now"** to populate Selected Vendors.
9. Run **`extractBudgetToFlat()`** to populate `budget_flat` from Budget.
10. **Deploy ▸ New deployment ▸ Web app**
    - Execute as: **Me**
    - Who has access: **Anyone**
    - Copy the deployment URL.

### 3. Create `config.js`

```js
// config.js
window.WEDDING_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfyc.../exec',
  secret: 'wplanner-8f3a2c9b7e1d4a6f5b8c2e9d3a7f1b4c'
};
```

`secret` must match `API_SECRET` in the Apps Script file.

### 4. Deploy the site

Push `index.html`, `app.js`, `styles.css`, and `config.js` to a GitHub Pages
branch. Load the page — the sidebar should populate and the Overview should
render.

---

## Configuration reference

### `config.js`

| Key      | Type   | Description                                     |
| -------- | ------ | ----------------------------------------------- |
| `apiUrl` | string | Deployed Apps Script Web App URL (ends `/exec`) |
| `secret` | string | Must match `API_SECRET` in the Apps Script file |

### `_app_config` (Sheet)

One row per exposed sheet. Column layout (see the sheet for the canonical
headers):

| Col | Field         | Purpose                                                                                                       |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------- |
| A   | `sheet`       | Sheet name (tab name verbatim)                                                                                |
| B   | `label`       | Sidebar label                                                                                                 |
| C   | `headerRow`   | Row holding the column headers                                                                                |
| D   | `dataStart`   | First data row                                                                                                |
| E   | `idColumn`    | Which column holds the primary key                                                                            |
| F   | `visible`     | Show in nav?                                                                                                  |
| G   | `sortOrder`   | Sidebar ordering                                                                                              |
| H   | `fields`      | Optional JSON array of custom field defs                                                                      |
| I   | `type`        | `data` or `link`                                                                                              |
| J   | `url`         | Target URL for `type=link`                                                                                    |
| K   | `checkField`  | Column holding the completion checkbox                                                                        |
| L   | `nameField`   | Column holding the display name                                                                               |
| M   | `statusField` | Column holding a status pill                                                                                  |
| N   | `dateField`   | Column holding a due date                                                                                     |
| O   | `quickAdd`    | Comma-separated quick-add form fields                                                                         |
| P   | *(reserved)*  | —                                                                                                             |
| Q   | `view`        | Renderer: `renderTimeline`, `renderBudget`, `renderGuests`, `renderGifts`, `renderQuickList`, `renderVendors` |
| R   | `budgetMode`  | `TRUE` for `budget_flat`                                                                                      |

### `_app_meta` (Sheet)

| Col | Field   | Purpose                           |
| --- | ------- | --------------------------------- |
| A   | `key`   | Machine-readable identifier       |
| B   | `value` | The value itself                  |
| C   | `group` | Section header on the Overview    |
| D   | `label` | Human label (falls back to `key`) |

The Overview displays every group except `Dates`, `Couple`, and `Team`, which
are rendered specially or moved to dedicated tabs.

---

## Sheet conventions

The app is deliberately forgiving about column names. A few conventions make
everything smoother.

### Field-role detection

For every sheet, the app tries to auto-detect four roles from the headers:

| Role          | Matching pattern                                                                                           | Fallback     |
| ------------- | ---------------------------------------------------------------------------------------------------------- | ------------ |
| `checkField`  | Returned, Packed, Done, Thanked, Arrived, Signed, Completed, Bought, Booked, Received, Sent, Paid, Decided | *(none)*     |
| `nameField`   | Name, Item, Task, Thing, Vendor, Description, Title, Guest, Company                                        | first column |
| `statusField` | Status, Stage, Response, State, Category                                                                   | *(none)*     |
| `dateField`   | Date, Due, When, Deadline                                                                                  | *(none)*     |

Override per sheet by setting the corresponding column in `_app_config`.

### `budget_flat`

The real Budget sheet has merged section rows and subtotals, which are painful
to parse on the fly. `budget_flat` is a normalised mirror generated by
`extractBudgetToFlat()`:

| Column              | Description                             |
| ------------------- | --------------------------------------- |
| `id`                | Auto-generated (`b0001`, `b0002`, …)    |
| `section`           | Section name (e.g. `PRE-WEDDING`)       |
| `item`              | Line item name                          |
| `budgeted`          | Budgeted amount                         |
| `actual`            | Actual amount                           |
| `deposit`           | Amount paid                             |
| `date_last_deposit` | Last deposit date                       |
| `date_next_deposit` | Next deposit due date                   |
| `notes`             | Free-form notes                         |
| `budget_row`        | Physical row in the source Budget sheet |

Writes to `budget_flat` propagate back to the Budget sheet via
`syncFlatToBudget()`.

**After any structural change to the Budget sheet** (inserting or deleting
rows), re-run **⚙️ Workbook Tools ▸ Refresh budget_flat from Budget**. The
`budget_row` column stores physical row numbers, so a row insert shifts every
reference below the insertion point — without a refresh, edits land on the
wrong rows.

### Vendors

The **Vendors** view reads from four source sheets:

- `Wedding Vendor Sourcing`
- `Household Vendor Sourcing`
- `Food Vendor Sourcing`
- `Honeymoon Vendor Sourcing`

`Selected Vendors` is populated by the macro but not read by the app. To
change which sheets feed the vendor view, edit `VENDOR_SOURCES` at the top of
`app.js`.

### Team

The Team view reads a table inside the Team sheet. The macro scans column A
for a cell whose value is exactly `Team Member`, then reads every row below
it until one starting with `Total`. Adding team members via the app writes
into the same table.

To stop the scan before a section that follows the team table, insert a row
whose column A contains `Total`, or leave a wide blank gap.

---

## Views and features

### Virtual views (not backed by a sheet)

| Route       | What it shows                                                                 |
| ----------- | ----------------------------------------------------------------------------- |
| `_today`    | Overdue tasks, this week's deadlines, pending guests, deposits due in 14 days |
| `_overview` | Hero with countdown, key dates, progress bars, editable meta groups           |
| `_team`     | Team directory as contact cards with call/WhatsApp and inline edit            |
| `_vendors`  | Vendor pipeline grouped by stage of communication                             |
| `_search`   | Global search across every exposed sheet                                      |

### Sheet-backed views

Set the renderer in `_app_config` column `view`. Falls back to
`renderQuickList`.

| Route                             | Renderer          | Notes                                         |
| --------------------------------- | ----------------- | --------------------------------------------- |
| `Planning Schedule`               | `renderTimeline`  | Date-bucketed, "Next up" hero, chip filters   |
| `Bridal List`                     | `renderBudget`    | Section cards, over-budget badges             |
| `budget_flat`                     | `renderBudget`    | Five stat cards including Available           |
| `Guest List`                      | `renderGuests`    | RSVP buttons, hotel pill, bride/groom buckets |
| `Gifts Received`                  | `renderGifts`     | Acknowledged checkbox                         |
| `Cash Contributions`              | `renderGifts`     | Sum shown as ₦                                |
| `Rentals Tracker`                 | `renderQuickList` | Returned checkbox                             |
| `Things to get to and from venue` | `renderQuickList` | Packed / taken / returned checkboxes          |
| `Things to take back to new home` | `renderQuickList` | Packed checkbox                               |

### Layout

- **Desktop** — collapsible sidebar (state persisted in `localStorage`).
  Toggle lives at the sidebar's right edge and slides left when collapsed.
- **Mobile** — sidebar becomes a slide-in drawer with a backdrop.
- **Today page** — 2 cards per row on desktop, 1 on mobile.
- **Stats grids** — `auto-fit` reflows; four cards usually sit in a single row
  on a wide monitor, five wrap to `3 + 2`.

### Editing

Any row with a `⋯` or an expand affordance opens an inline editor when tapped.
Only the fields you actually change are sent to the server — untouched fields,
including formula-driven date cells, are omitted from the write.

Dropdowns in the editor are pulled from the sheet's own data validations,
sampled from the first 30 rows of each sheet.

---

## How the numbers are calculated

### Overview tab

Every number on this tab is pre-computed by the macro and delivered in one
payload, cached for 5 minutes.

- **Guests confirmed** — sum of the `Number to expect` column, restricted to
  rows whose `Guest Response` is exactly `Coming`. Card shows "coming / total".
- **Actual cost** — total `actual` spend across the whole budget, divided by
  the total `budgeted`. Shown as a percentage.
- **Plan tasks done** — rows with a ticked checkbox in Planning Schedule,
  out of total task rows.
- **Bridal tasks done** — same idea, for the Bridal List.
- **Progress bars** — the same four numbers re-expressed as percentages:
  Planning schedule, Bridal list, Guest confirmations, Paid so far.

### Bridal List tab

Computed live in the browser from the Bridal List rows.

- **Budgeted / Actual cost / Paid** — column sums across every row.
- **Outstanding** — Actual − Paid.
- **Paid so far bar** — Paid ÷ Actual.
- **Section cards** — one per all-caps section header in the sheet; each shows
  the section's own totals, its own progress bar, and an "Over by ₦X" badge if
  Actual exceeds Budgeted.

### Budget tab

Same structure as Bridal List but reads from `budget_flat`.

- **Budgeted / Actual cost / Paid / Outstanding** — as above.
- **Available** — read straight from `Budget!B20`. No further math. If B20 is
  blank the card shows `—` with a hint.

---

## Redeploying after changes

### Frontend

1. Commit and push to the Pages branch.
2. Bump the cache-buster in `index.html`:
   ```html
   <script src="app.js?v=19"></script>
   ```
   Increment the number so returning visitors pick up the new file.
3. Hard-refresh once to confirm.

### Apps Script

Editing the local file does nothing — Apps Script lives on Google's servers.
To apply changes:

1. Open the Sheet → **Extensions ▸ Apps Script**.
2. Paste in the new source.
3. Save.
4. **Deploy ▸ Manage deployments** → pencil icon → **Version: New version**
   → **Deploy**.

Step 4 is the one people forget. Without it, the `/exec` URL keeps serving
the previous code even though the editor shows your changes.

---

## Troubleshooting

### "unauthorized" on every request

- `config.js` `secret` doesn't match `API_SECRET`
- You edited `API_SECRET` but didn't redeploy

### "sheet not configured"

The sheet isn't listed in `_app_config`, its `visible` flag is `FALSE`, or
the request's sheet name doesn't match exactly.

### "sheet not found"

`_app_config.sheet` doesn't match an actual tab name. Copy the tab name
verbatim.

### Overview shows stale values after editing

The 5-minute cache. Hit **Refresh** in the sidebar. If the value still doesn't
update, verify the write actually landed in the sheet — check the cell.

### Bridal List edits don't persist

The editor resolves column names case-insensitively from `schema.columns`.
If a column has been renamed in the sheet, the editor may be writing to a
column that no longer exists. Check the headers in `_app_config` and the
sheet match.

### Vendor card collapses when using the dropdown

The click handler ignores anything inside `.vendor-actions`. If it still
collapses, check that `.vendor-actions` is present in `renderVendorRow`'s
output and that no other click handler on `#view` is interfering.

### Row stays white after ticking a checkbox from the app

`applyRowFormattingForSheet` is called by `apiUpdate` after every write. If
rows go grey in the sheet but stay white from the app, the macro hasn't been
redeployed with the latest `apiUpdate`.

### Everything is 5 minutes behind

That's the cache TTL. Hit **Refresh** to bypass it.

---

## Known quirks

- **Subtitles vanish after filtering.** Some views call their own renderer
  directly instead of going through `render()`, so the subtitle isn't
  re-injected. Fixable by swapping those handlers to `render()`.
- **`state.filter` is dual-purpose.** Most views store a filter mode; the
  Guest List also stores `'<sheet>_resp'` for the response filter. Works
  because the keys can't collide, but it's brittle.
- **`bindRowInteractions` uses `view.onclick`** (not `addEventListener`) so
  repeated renders don't stack handlers. Guests and Vendors bind their own
  scoped handlers instead.
- **Team edits use different API paths** (`updateTeam`, `deleteTeam`,
  `createTeam`) than other sheets. They bypass `_app_config` entirely.
- **Vendor edits use `update` with a row hint**, not an ID lookup. This works
  because the sourcing sheets have no reliable primary key.

---

## Local development

Run the app without a build step:

1. Serve the directory: `npx serve .` or `python3 -m http.server 8000`.
2. Create `config.js` next to `index.html`.
3. Open `http://localhost:8000` — the app talks to your live Apps Script
   deployment, which talks to the Sheet.

There's no dev mode for the API. Every save writes to the live workbook. For
a sandbox, duplicate the Sheet, create a second Apps Script deployment
pointing at the duplicate, and use a second `config.js` locally.

### Regenerating `budget_flat`

If `budget_flat` drifts out of sync, open the Sheet and run
**⚙️ Workbook Tools ▸ Refresh budget_flat from Budget**, or run
`extractBudgetToFlat()` from the Apps Script editor.

Do this after any change to the physical layout of the Budget sheet — inserting
or deleting rows shifts the `budget_row` references stored in `budget_flat`,
and app edits will land on the wrong rows until it's refreshed.

---

## License

Private project — not licensed for redistribution.