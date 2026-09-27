# Ticket Ticker — project context for AI agents

Read this before changing anything. It explains what the app is for, the domain it models, how the code is laid out, and the rules to follow when editing it.

## 1. What this is

Ticket Ticker is a personal web app for a data center technician who works fiber and optics tickets hall by hall. The official ticket tool (Meta's internal enterprise ticketing, viewed on a phone as the "Cableguy" screen) shows one ticket at a time. This app puts every ticket for the halls you're covering on one board, lets you filter them, and opens each one in a detail view laid out like the Cableguy screen.

- Owner: mithilreddykoduru (GitHub)
- Repo: `ticket-ticker`
- Type: static site, no backend, no build step, no dependencies
- Runs by opening `index.html`, or from any static server
- Hosting: GitHub Pages through `.github/workflows/pages.yml`

It does **not** connect to Meta's ticketing system. That system sits behind Meta's internal network and SSO. Tickets come in through a JSON import. Don't add code that calls internal Meta endpoints, scrapes the tool, or stores credentials.

## 2. The domain

### Halls
| Hall | Type | Room code |
| --- | --- | --- |
| NS 1, NS 2, NS 3, NS 4 | Network Suite | NS1–NS4 |
| DH A, DH B, DH C, DH D | Data Hall | 1A, 1B, 1C, 1D |

Each hall has its own tickets. A technician usually covers a few halls at once, so hall selection is a multi-select.

### How NS and DH tickets connect
Fiber runs from the data hall switches back to the network suite. An NS ticket is always tied to a DH ticket where that fiber path ends. In the app, an NS ticket and a DH ticket are linked when they share an **SSW** host.

### Switch tiers (path order)
`XSW › SSW › FSW`
- XSW: top tier, in the network suite
- SSW: spine, where NS fiber lands
- FSW: fabric switch in the data hall pod

Hostnames look like `ssw014.s001.m011.mca1` and `fsw005.p004.m011.mca1`. The tier is the letters before the first digits. Ports look like `eth1/40/1`.

### Location string
The ticket header reads `tkt26826746 · MCA1, 1B, 10, 38, 22.00`, which is:
`site, room, row, rack, elevation`

- Elevations **46–47** are always FCAN positions on the rack.
- **O** and **C** are the goal posts on either side of a row. Each ticket has one of them as its `post`.

### What a link shows (matches the Cableguy screen)
For each link `A host > B host` with ports `A port > B port`:
- **Local Optics / Remote Optics**: 4 RX lanes, 4 TX lanes (dBm), the alarm window `[alrm_lo, alrm_hi]` (usually `[-7.20, 4.50]`), and `Vendor/ID`
- **Local Iface Stat / Remote Iface Stat**: `admin_status`, `oper_status`, `in_errors`, `out_errors`
- **Local LLDP / Remote LLDP**: the neighbour each side sees, as `host:port`

### Link status rules (in `js/model.js`, first match wins)
| Status | Rule |
| --- | --- |
| Pending | no local or remote data yet |
| Local Loop | local LLDP neighbour is the same host as side A |
| Mismatched Int | local LLDP neighbour isn't `bHost:bPort` |
| No TX | any local TX lane < alarm low, or any remote RX lane < alarm low − 10 |
| No RX | any local RX lane < alarm low |
| Failed | either side oper not `up`, or any in/out errors |
| Circuit Up | none of the above |

Severity for rolling up to a ticket: `up 0 < pending 1 < loop, mismatch 2 < norx, notx, failed 3`. A ticket takes its worst link's status. The list sorts red, then amber, then pending, then green.

### Optic colouring
- red: outside `[lo, hi]`
- amber: within 1 dB above `lo`, or within 0.5 dB below `hi`
- green: otherwise (TX chips stay neutral when fine, like the Cableguy screen)

## 3. Files

```
index.html                   layout: header, hall picker, status tiles, filters, list, detail, import & summary dialogs
manifest.webmanifest         PWA manifest for home screen install
sw.js                        service worker for offline data center use
vercel.json                  Vercel configuration, headers, and caching
package.json                 scripts and metadata
css/styles.css               all styles; light tokens on :root, dark tokens in a media query and [data-theme="dark"]
js/storage.js                TT.store: get/set on localStorage with 'tt.' prefix, wrapped in try/catch
js/model.js                  TT.HALLS, TT.STATES, TT.TIERS, TT.ALARM, linkState, ticketState, helpers
js/sample.js                 TT.buildSample(): seeded fake tickets; first one is the real tkt26826746
js/importer.js               TT.normalize(), TT.fromCsv(), TT.autoLink(), TT.template(), TT.toCsv()
js/app.js                    UI state, rendering, events, dialogs, grouping, done tracking, theme, notes, export
data/template.json           example import file
.github/workflows/pages.yml  GitHub Pages deploy on push to main
.gitignore                   keeps real exports (*.csv, tickets*.json, export*.json) out of git
README.md                    user-facing docs
AGENTS.md                    this file
```

Scripts load in this order in `index.html`: storage → model → sample → importer → app. Everything hangs off one global, `window.TT`. There are no modules and no bundler, so keep it that way unless the owner asks for a framework.

## 4. Data shapes

### Ticket inside the app (after `TT.normalize`)
```js
{
  id: 'tkt26826746',
  hall: 'DH B',                 // one of TT.HALLS ids
  work: 'Cable - Cleaned',      // work status / title
  site: 'MCA1', room: '1B',
  row: 10, rack: 38, elev: 22,  // numbers
  post: 'O',                    // 'O' | 'C' | ''
  linked: ['tkt…'],             // ticket ids on the other side (NS <-> DH), always two-way
  links: [{
    a: { host: 'ssw014.s001.m011.mca1', port: 'eth1/40/1' },
    b: { host: 'fsw005.p004.m011.mca1', port: 'eth1/29/1' },
    local:  { rx:[4], tx:[4], alarm:[lo,hi], vendor, admin, oper, inErr, outErr, lldp } | null,
    remote: { same shape } | null
  }]
}
```

### What import accepts
- A list of tickets, or `{ "tickets": [...] }`
- `location: "MCA1, 1B, 10, 38, 22.00"` or separate `site/room/row/rack/elev`
- `hall` optional if `room` maps to a hall
- Endpoints as `"host:port"` or `{host, port}`
- Iface fields as `admin_status/oper_status/in_errors/out_errors` or `admin/oper/inErr/outErr`
- `linked` optional; `TT.autoLink` links NS and DH tickets that share an SSW

### Stored in localStorage
| Key | Holds |
| --- | --- |
| `tt.tickets` | imported tickets (normalized) |
| `tt.halls` | selected hall ids |
| `tt.notes` | `{ ticketId: text }` |
| `tt.done` | `{ ticketId: timestamp }` completed tickets |
| `tt.hideDone` | boolean to hide completed tickets |
| `tt.groupBy` | `'none' \| 'hall' \| 'row' \| 'state'` |
| `tt.theme` | `null`, `'dark'` or `'light'` |

## 5. Features today
- Multi-select halls with counts, plus Select all / Clear
- Starts with all halls selected and all filters cleared by default
- Seven status tiles that count links in the selected halls and act as toggle filters
- Filters: tier (XSW/SSW/FSW), row, O/C post, FCAN 46–47, Group By (Hall, Row, Status), Hide Done, text search (`/` focuses it), reset
- Done tracking: mark tickets complete directly from the list card or detail header; toggle "Hide done" to keep the board clean
- Grouping: group by Hall, Row, or Link Status with badge counts per group
- Shift summary: full table of tickets by hall and link status, plus one-click copy to markdown for handoff notes
- Detail: hall/row/rack/elev/post facts, rack elevation visualizer (U1–U47 with FCAN zone and post), per-status mini counts, fiber path chips, linked-ticket jump buttons, one collapsible block per link with optics, iface stats and LLDP, notes box
- JSON and CSV import (paste or file), template loader, back-to-sample
- CSV export of what's in view, one row per link
- Offline PWA: installable, service worker caching for 100% offline usage in RF-shielded data halls
- Network status indicator: discreet dot showing online vs. cached offline status
- Keyboard navigation: `j`/`k` (or arrows) to step through tickets, `x` to toggle done, `/` to search, `Esc` to close
- Light/dark theme following the system, with a toggle
- Phone layout: detail opens full screen with a back button, Esc also closes it

## 6. Running
```bash
# either open index.html directly, or:
python3 -m http.server 8080
# then http://localhost:8080
```
Quick logic check without a browser:
```bash
node -e 'global.window=global;["storage","model","sample","importer"].forEach(f=>require("./js/"+f+".js"));const s=TT.buildSample();console.log(s.length, TT.linkState(s[0].links[0]))'
# expect: 44 up
```

## 7. Rules for editing

- Keep it dependency-free vanilla JS, HTML and CSS. No npm, no build step, unless asked.
- All colours come from the CSS tokens. Any new token needs a light value on `:root` and a dark value in **both** dark blocks.
- Keep labels and chip text matching the Cableguy screen (`Local Optics`, `Remote Iface Stat`, `[alrm_lo, alrm_hi]`, `admin_status = up`, and so on). The owner reads these at a glance on the floor.
- Status rules live only in `TT.linkState`. Don't duplicate them in the UI.
- Escape every ticket value that goes into HTML with `esc()` in `app.js`.
- Wrap every localStorage call through `TT.store`.
- Hall list, status list and tier list live only in `model.js`. Adding a hall means one new line in `TT.HALLS`.
- The phone layout must keep working at ~400px wide.
- Never commit real ticket exports. `.gitignore` already blocks the common names.
- Write code that reads like a person wrote it: plain names, short comments only where the reason isn't obvious, no boilerplate banners.
- Commit messages: short summary line, then a plain description of what changed.

## 8. Ideas the owner may ask for next
- A field mapper in the import dialog for the real export format once a sample is available
- Grouping the list by row or rack
- Rack elevation view (1–47) with FCAN 46–47 marked and O/C posts at either end of the row
- Marking tickets done / hiding completed work
- Shift summary: counts by status per hall for handoff
- PWA manifest and service worker so it works offline on the floor
