# Wedding Planner — Companion App

A custom, static web app used to manage the wedding plans. No build step, no frameworks, no dependencies. Just HTML, CSS, vanilla JavaScript, and a Google Apps Script backend.

## 1. Architecture
- **Frontend:** Hosted on GitHub Pages (`index.html`, `app.js`, `styles.css`, `config.js`).
- **Backend API:** A Google Apps Script deployed as a Web App (`@OnlyCurrentDoc.txt`).
- **Database:** A Google Sheet (the `_app_config` and `_app_meta` tabs drive the app's behavior).

## 2. Core Features
- **Overview Dashboard:** Displays countdown, unified progress, and editable finance cards (Savings and Goals). Includes collapsible accordions for Wedding Details.
- **Merged Views:** 
  - **Gifts & Cash:** Merges two sheets into one view, grouped by "To Thank" and "Thanked".
  - **Logistics:** Merges Venue Run, New Home, and Rentals. Rentals use an inline dropdown mapped to checkboxes.
- **Smart Quick-Add:** Context-aware forms for Budget (inserts into specific sections), Bridal (inserts below chosen section headers), and Vendors (dynamically maps to the correct source sheet).
- **Vendor to Team Sync:** When a vendor's stage is set to *Chosen/Approved* (or anything beyond), they are automatically injected into the `Team` tab.
- **Global Search:** Searches across all sheets. Results are clickable and jump directly to the row in its respective tab.

## 3. Setup & Configuration

### The Google Sheet
The app is entirely driven by the `_app_config` sheet. If you add a new sheet, you must configure it here.
- **Column P (`vendorKind`)**: Tells the app this sheet is a vendor source.
- **Column Q (`view`)**: Defines how the tab renders (e.g., `renderTimeline`, `renderBudget`, `renderQuickList`).
- **`dataStart`**: The row where data begins (usually 2, but 3 for Guest List).
- **`nameField`**: The primary column for items (e.g., "Item", "TASK", "Name").

### The Apps Script Backend (`@OnlyCurrentDoc.txt`)
1. Open the Apps Script editor from your Google Sheet.
2. Paste the contents of `@OnlyCurrentDoc.txt`.
3. Ensure `API_SECRET` matches the `secret` in your `config.js`.
4. **Crucial:** Any time you change the backend code, you **must** deploy a new version:
   `Deploy` → `Manage deployments` → `Edit` → `Version: New version` → `Deploy`.

### The Frontend (`app.js`)
If you make changes to `app.js` or `styles.css`, you must hard-refresh your browser (`Ctrl+Shift+R` or `Cmd+Shift+R`) to see the changes. The sidebar "Refresh" button only clears the data cache; it does not reload the schema or the app code.

## 4. Troubleshooting

- **"Rows out of bounds" error:** The Google Sheet ran out of physical rows. The backend script now auto-expands the sheet, but you can also manually add rows to the bottom.
- **Items not saving / appearing at row 1500:** The app relies on the `nameField` in `_app_config`. If a sheet's `nameField` doesn't match its actual column header, the backend cannot find the last row. Ensure the spelling matches exactly.
- **Ghost Items:** If you see hundreds of blank items, it means the app is reading pre-filled checkboxes at the bottom of the sheet. The backend filters these out based on the `nameField`, but ensure your `nameField` column is completely blank on empty rows.
- **Old tabs showing:** If merged tabs (Gifts, Logistics) still show their source sheets in the sidebar, ensure `renderNav()` in `app.js` includes them in the `HIDDEN_SHEETS` array.