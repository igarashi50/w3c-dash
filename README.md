# W3C Dash

W3C Dash is a web application for visualizing W3C statistics. It provides interactive tables and visual summaries to explore the structure and participation of W3C working groups, interest groups, community groups, task forces, and more.

All data is fetched from the W3C API (https://www.w3.org/api/) and stored as local JSON  files, which are used to provide interactive statistics and rich insights.

## Features
- Visualizes W3C group participation and participants
- Interactive sortable tables and visual summaries
- Drill-down popups for members, participants, and user details
- Supports filtering by group type (WG, IG, CG, TF, Other)
- Fetches data snapshots from the W3C API using a Node.js script


## Project Structure
- `index.html` — Main HTML file for the dashboard UI
- `w3c-dash.js` — Main UI logic and event handling
- `w3c-api.js` — Data access and aggregation logic
- `w3c-dash.css` — Styles for the dashboard
- `data/` — Pre-fetched W3C API data in JSON format
- `scripts/fetch-w3c-data.js` — Node.js script to fetch and update data via the W3C API
- `.github/workflows/fetch-w3c-data.yml` — GitHub Actions workflow for automated data fetching and updates
- `README.md` — Project overview and usage instructions
- `LICENSE` — License information

## Usage

> **Recommended:**
>
> The public "W3C Dash" is available at the GitHub Pages site of this repo:
> [https://igarashi50.github.io/w3c-dash/](https://igarashi50.github.io/w3c-dash/)
>
> This site provides up-to-date statistics based on weekly fetched data snapshots. For most users, we recommend using this hosted version.

If you want to run locally or update the data yourself:
1. Fetch the latest data:
   ```bash
   node scripts/fetch-w3c-data.js
   ```
2. Start a local server (optional, for CORS):
   ```bash
   python3 -m http.server 8000
   # Then open http://localhost:8000 in your browser
   ```
   Or simply open `index.html` directly in your browser.


## Development
- To add UI features, edit `w3c-dash.js` and `w3c-dash.css`.
- To change data logic, edit `w3c-api.js`.
- To modify data fetching, edit `scripts/fetch-w3c-data.js`.
- For layout changes, edit `index.html`.

## Data Flow
1. **Data Fetching**: Run `node scripts/fetch-w3c-data.js` to fetch the latest W3C API data and save it to `data/*.json`.
2. **Data Loading**: The dashboard loads these JSON files in the browser and processes them via `w3c-api.js`.
3. **UI Rendering**: `index.html` and `w3c-dash.js` builds tables and popups for interactive exploration.

## Dependencies
No npm or package.json required

## License
See [LICENSE](LICENSE) for details.

## Disclaimer
The information provided by this application is based on data fetched from the public W3C API. However, the accuracy, completeness, or reliability of the data is not guaranteed. Use of the fetched data is subject to the terms and conditions set by the W3C API.

## Author
Maintained by @igarashi50

---