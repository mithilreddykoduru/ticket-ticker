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
- **Export.** Downloads whatever is in view as a CSV, one row per link.
- **Light and dark.** Follows the system theme; the ◐ button overrides it.

## Getting tickets in

The board opens with sample tickets. The first one, `tkt26826746`, is copied exactly from a real ticket screen. The rest are made up.

To load real tickets, use **Import tickets** and paste or pick a JSON file. `data/template.json` shows the format. Everything saves in the browser's local storage and never leaves your device.

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

## Running it

```bash
# any static server works, or just open index.html
python3 -m http.server 8080
```

## Hosting on GitHub Pages

The workflow in `.github/workflows/pages.yml` publishes the site on every push to `main`. Turn it on once under **Settings → Pages → Build and deployment → Source: GitHub Actions**. Pages on a private repo needs a paid GitHub plan; on a free plan, make the repo public or just run it locally.

## Files

```
index.html          page layout
css/styles.css      all styling, light and dark tokens
js/storage.js       safe localStorage wrapper
js/model.js         halls, statuses, link and ticket rules
js/sample.js        seeded sample tickets
js/importer.js      JSON import, auto-linking, CSV export
js/app.js           rendering and events
data/template.json  import example
```
