# Ticket Ticker

A small board for working hall tickets in the data center. Pick the halls you're covering, filter by link status, and open a ticket to see the fiber path, optics, interface stats and LLDP for every link on it. The detail view is laid out the same way the Cableguy screen reads on the phone.

It's plain HTML, CSS and JavaScript with no build step and no dependencies. Open `index.html` in a browser and it runs.

## What it does

- **Halls.** Network Suites NS 1–4 and Data Halls DH A–D. Select any mix of them; the choice is remembered.
- **Status tiles.** Pending, Circuit Up, Local Loop, Mismatched Int, No RX, No TX and Failed, counted across every link in the selected halls. Tap a tile to filter by it.
- **Filters.** Switch tier (XSW / SSW / FSW), row, goal post side (O or C), FCAN elevations (46–47), and a search box that covers ticket IDs, hosts, ports, locations and your notes. Press `/` to jump to search.
- **NS ↔ DH linking.** An NS ticket gets linked to any DH ticket on the same SSW, since that's where the fiber from the suite lands. The detail view draws the XSW › SSW › FSW path and lets you jump between linked tickets.
- **Optics check.** RX and TX values are coloured against the alarm window: green inside, amber within 1 dB of the low alarm, red outside.
- **Notes.** Each ticket has a notes box that saves on your device.
- **Done tracking.** Check off completed tickets with the checkmark on the card or in the detail view; toggle **Hide done** to clear your board.
- **Grouping.** Group tickets by Hall, Row, or Status with section counts to walk rows systematically.
- **Shift summary.** Click **Shift summary** for a full table of tickets by hall and worst status, plus one-click copy to markdown for handoff notes.
- **Rack elevation visualizer.** Visual U1–U47 rack position gauge with FCAN (46–47) highlighting and goal post badges.
- **Export & Import.** Downloads CSVs or imports JSON/CSV exports directly.
- **Offline PWA.** Installs to home screen on mobile/desktop and works 100% offline in shielded suites via service worker caching.
- **Light and dark.** Follows the system theme; the ◐ button overrides it.
- **Keyboard shortcuts.** `/` focuses search, `j`/`k` (or `↓`/`↑`) moves through tickets, `x` toggles done, `Esc` closes detail.

## Getting tickets in

The board opens with sample tickets. The first one, `tkt26826746`, is copied exactly from a real ticket screen. The rest are made up.

To load real tickets, use **Import tickets** and paste or pick a JSON or CSV file. `data/template.json` shows the JSON format. Everything saves in the browser's local storage and never leaves your device.

```json
{
  "tickets": [{
    "id": "tkt26826746",
    "hall": "DH B",
    "work": "Cable - Cleaned",
    "location": "MCA1, 1B, 10, 38, 22.00",
    "post": "O",
    "links": [{
      "a": "ssw014.s001.m011.mca1:eth1/40/1",
      "b": "fsw005.p004.m011.mca1:eth1/29/1",
      "local":  { "rx": [0.61, 1.36, 0.94, 1.84], "tx": [2.5, 1.75, 2.28, 1.97], "alarm": [-7.2, 4.5],
                  "oper_status": "up", "in_errors": 0, "lldp": "fsw005.p004.m011.mca1:eth1/29/1" },
      "remote": { "rx": [-6.88, -6.35, -6.63, -6.95], "tx": [1.85, 2.12, 1.81, 1.9], "alarm": [-7.2, 4.5],
                  "oper_status": "up", "in_errors": 0, "lldp": "ssw014.s001.m011.mca1:eth1/40/1" }
    }]
  }]
}
```

Notes on the format:

- `location` follows the ticket header order: site, room, row, rack, elevation. You can also pass `site`, `room`, `row`, `rack` and `elev` as separate fields.
- If `hall` is missing, it's worked out from the room (`1B` → `DH B`, `NS2` → `NS 2`).
- Endpoints can be `"host:port"` strings or `{ "host": ..., "port": ... }` objects.
- Interface fields accept either the ticket tool's names (`admin_status`, `oper_status`, `in_errors`, `out_errors`) or the short ones (`admin`, `oper`, `inErr`, `outErr`).
- `linked` is optional. NS and DH tickets that share an SSW are linked automatically, and every link is made two-way.

A link with no `local` or `remote` data shows as Pending.

## How a link gets its status

Checked in this order, first match wins:

| Status | Rule |
| --- | --- |
| Pending | no local or remote readings yet |
| Local Loop | local LLDP neighbour is the same switch |
| Mismatched Int | local LLDP neighbour isn't the expected far-end port |
| No TX | a local TX lane is below the low alarm, or the far end sees dead light |
| No RX | a local RX lane is below the low alarm |
| Failed | either side is oper down or has in/out errors |
| Circuit Up | everything above is clean |

A ticket takes the status of its worst link. The list sorts red first, then amber, then pending, then clean.

## Running locally

```bash
# any static server works, or just open index.html
python3 -m http.server 8080
# or with npm:
npm start
```

## Hosting on Vercel

Configured for zero-config deployment on Vercel with `vercel.json`:
- Security headers (CSP frame options, sniffing protection, referrer policy)
- Immutable caching on static assets and instant revalidation on HTML and service worker
- Push this repo to GitHub and import it on [vercel.com](https://vercel.com), or run `vercel` in the project root.

## Hosting on GitHub Pages

The workflow in `.github/workflows/pages.yml` publishes the site on every push to `main`. Turn it on once under **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Files

```
index.html          page layout and structure
manifest.webmanifest PWA manifest for home screen install
sw.js               service worker for offline data center use
vercel.json         Vercel security headers and caching configuration
package.json        scripts and project metadata
css/styles.css      all styling, light and dark tokens
js/storage.js       safe localStorage wrapper
js/model.js         halls, statuses, link and ticket rules
js/sample.js        seeded sample tickets
js/importer.js      JSON and CSV import, auto-linking, CSV export
js/app.js           rendering, filtering, grouping, handoff summary, shortcuts
data/template.json  import example
icons/              app icons for PWA and favicon
```
