# Warehouse 3D Map (v2: pick data Oct 21 - Nov 4, 2026)

Interactive 3D warehouse map: racking from D365 location profiles, pick-velocity heat colors,
day toggle, bin and item search, trend popups, top items, collapsible/draggable panels.

## Files
- `index.html` - page layout and styling
- `main.js` - all map logic (three.js loaded from a CDN via the import map)
- `data/levels.js` - bin positions, levels, rack height/depth/pick-backup flags
- `data/velocity.js` - pick quantity per bin, all days and per day
- `data/iteminfo.js` - dominant item, description and times picked per bin
- `data/trend.js` - per-item and per-bin daily trend data
- `versions/` - dated single-file snapshots (open directly in a browser, no server needed)

## Run locally
The split version must be served, not double-clicked (browsers block ES modules from file://):

    python3 -m http.server 8000

then open http://localhost:8000

## Deploy on GitHub Pages
Push this folder to a repo, then Settings > Pages > deploy from the main branch (root).
The data files are plain JS assigning `window.*` globals, so a live pipeline can regenerate
the files in `data/` and the map picks them up unchanged.
