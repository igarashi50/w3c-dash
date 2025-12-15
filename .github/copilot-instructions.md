
# W3C Dash Development Guide

## Overview
W3C Dash is a **client-side web application** for visualizing W3C group participation statistics. The application consists of a static HTML page that loads pre-fetched W3C API data from JSON files and renders interactive tables and visual summaries. No Chart.js is used; all visualizations are custom DOM-based.

## Architecture

### Project Structure
- `index.html` — Main HTML file for the dashboard UI
- `w3c-dash.js` — Main UI logic and event handling
- `w3c-api.js` — Data access and aggregation logic
- `w3c-dash.css` — Styles for the dashboard
- `data/` — Pre-fetched W3C API data in JSON format
- `scripts/fetch-w3c-data.js` — Node.js script to fetch and update data via the W3C API
- `.github/workflows/fetch-w3c-data.yml` — GitHub Actions workflow for automated data fetching and updates
- `README.md` — Project overview and usage instructions
- `LICENSE` — License information

### Data Flow
1. **Data Fetching**: Run `node scripts/fetch-w3c-data.js` to fetch the latest W3C API data and save it to `data/*.json`.
2. **Data Loading**: The dashboard loads these JSON files in the browser and processes them via `w3c-api.js`.
3. **UI Rendering**: `index.html` and `w3c-dash.js` builds tables and popups for interactive exploration.

### Key Components
- **`w3c-api.js`**: Pure data access layer
  - `findDataByUrl()`: Central lookup function for all cached API data
  - `extractGroups()`: Aggregates groups from all types (wg, ig, cg, tf, other)
  - `extractGroupInfo()`: Computes derived metrics (invited experts, members, participants)
  
- **`w3c-dash.js`**: UI logic and event handling
  - `renderData()`: Main rendering function - builds sortable table with charts
  - `showMembersPopup()`: Three-pane popup (Members → Participants → User Details)
  - Custom DOM-based bar charts and summaries

### Data Model
```javascript
// Cached data structure (data/w3c-*.json)
{
  "_metadata": { /* fetch timestamp, duration */ },
  "https://api.w3.org/groups/wg": { 
    "fetchedAt": "2025-12-02T...",
    "data": { /* W3C API response */ }
  }
}
```

Participation types:
- **Members (M)**: Organizations participating (derived from `individual: false`)
- **Member Participants (MP)**: Member participants
- **Invited Experts (IE)**: `invited-expert: true`
- **Staffs (S)**: `individual: true` + W3C affiliation
- **Individuals (Ind)**: `individual: true` (non-staff)
- **Participants (P)**: U + IE + S + Ind

## Critical Patterns

### Data Fetching Script (`fetch-w3c-data.js`)
- **Rate Limiting**: 200ms between requests (REQUEST_INTERVAL constant)
- **Pagination**: Automatically merges multi-page API responses into single entries
- **Change Detection**: Compares new data with existing JSON, preserves timestamps if unchanged
- **Phased Execution**: 
  1. Groups + participations lists of each group + users lists of each group
  2. Participation details (requires phase 1)
  3. Affiliations (requires phase 2)
  4. User details (requires phase 1, 2, and 3)


```bash
# Usage examples
node scripts/fetch-w3c-data.js                    # Full refresh (all phases)
node scripts/fetch-w3c-data.js --test             # Test mode (7 sample groups)
node scripts/fetch-w3c-data.js --groups           # Phase 1 only
node scripts/fetch-w3c-data.js --participations   # Phase 2 only (requires existing w3c-groups.json)
```

### State Management
- **`groupsData`**: Global array in `w3c-dash.js` storing all group info for click handlers
- **`localStorage.groupTypeFilter`**: Persists selected group type filter (wg/ig/cg/tf/other/all)
- **Chart.js chart destruction**: Always call `Chart.getChart(canvas).destroy()` before creating new charts

### UI Interactions
1. **Sorting**: Click column headers → updates `sortBy` value → calls `renderData()`
2. **Filtering**: Group type buttons set `localStorage.groupTypeFilter` → calls `renderData()`
3. **Clickable counts**: Click any count cell → shows popup with names list
4. **Members drill-down**: Click "M" count → opens 3-pane popup with org → participants → user details flow

## Development Workflow

### Running Locally
```bash
# No build step required - open directly in browser
open index.html

# Or use a local server
python3 -m http.server 8000
# Navigate to http://localhost:8000
```

### Updating Data
```bash
# Full data refresh (takes ~2-3 hours for all W3C groups), where forceTestMode=false
node scripts/fetch-w3c-data.js

# Quick test with sample groups (or forceTestMode=true)
node scripts/fetch-w3c-data.js --test
```

### Key Files to Modify
- **Add UI features**: Edit `w3c-dash.js` and `w3c-dash.css`
- **Change data logic**: Edit `w3c-api.js` (calculation of metrics)
- **Modify data fetching**: Edit `scripts/fetch-w3c-data.js`
- **Adjust layout**: Edit `index.html` (minimal changes needed)

## Common Tasks

### Adding a New Metric
1. Calculate in `extractGroupInfo()` (w3c-api.js) - return in object
2. Add table column in `loadGroups()` (w3c-dash.js) - add to `columns` array and table cells
3. Add clickable handler if showing detail list

### Changing Chart Appearance
- Bar charts and summaries are rendered using custom DOM logic in `w3c-dash.js`.
- Colors: M=#0969da, U=#1f883d, IE=#bf8700, S=#cf222e, Ind=#8250df

### Debugging Data Issues
1. Check browser console for fetch errors
2. Inspect `data/w3c-*.json` for malformed entries
3. Use `data._metadata` to verify fetch timestamps
4. Look for `_error` property in group objects (indicates processing failures)

## Important Constraints

- **No server-side processing**: All data must be pre-fetched to JSON files
- **W3C API rate limits**: 6000 requests per IP per 10 minutes (script uses 50% of limit)
- **Browser memory**: Large datasets may require pagination (currently loads all groups at once)

## External Dependencies
  - No npm/package.json - intentionally dependency-free for simplicity
