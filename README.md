Here is the merged, unified `README.md`. 

It is written to welcome a couple who stumbles upon it, guide them through the setup, and then seamlessly transition into the critical "Admin Notes" that ensure they don't accidentally break the system later.

***

# 💍 The Google Sheets Wedding Planner

Welcome! This project is a free, private, and mobile-friendly wedding planner. 

Instead of paying for a monthly subscription app, this project turns your personal Google Sheet into a beautiful, modern web app that you can access from your phone. Your data stays 100% in your control (in your Google Drive).

**What it does:**
*   **Live Countdown:** See exactly how many days are left.
*   **Budget Tracker:** Automatically calculates your "Available Cash" by adding your savings and contributions, then subtracting the deposits you've paid.
*   **Guest & RSVP List:** Track who is coming, who is pending, and who needs a hotel.
*   **Task Management:** A timeline of everything you need to do, sorted by overdue and upcoming.
*   **Vendor Pipeline:** Keep track of every vendor, their phone number, and their stage (e.g., "Call scheduled", "Contract signed").
*   **Invitation Generator:** A cool bonus feature that automatically generates personalized PDF invitations (White Wedding and Traditional Marriage) from Google Slides templates.

> ⚠️ **A Quick Note on Setup:** Because this is a static site hosted on GitHub talking to a Google Sheet, **setting it up requires about 15–30 minutes of technical setup.** If you aren't comfortable editing code or JSON files, grab a tech-savvy friend to help you follow the steps below!

---

## 🚀 1. How to Set It Up

### Step 1: Get the Google Sheet
1. Make a copy of the provided Google Sheet template.
2. This sheet is now your database. Everything you type in the app will be saved here.

### Step 2: Set up the Backend (Google Apps Script)
1. Open your new Google Sheet.
2. Go to **Extensions > Apps Script**.
3. Delete any code there and paste the code from `Google Macros.txt`.
4. Find `const API_SECRET = '...'` and change it to a random password (e.g., `wplanner-secret-123`).
5. **Set up Permissions (Crucial):** Click the **⚙️ Project Settings** icon on the left. Check the box that says *"Show 'appsscript.json' manifest file in editor"*. Go back to the Editor, click on `appsscript.json`, and replace its contents with this exact block (this gives the script permission to read Google Slides for the invitation generator):
   ```json
   {
     "timeZone": "Africa/Lagos",
     "dependencies": {},
     "exceptionLogging": "STACKDRIVER",
     "runtimeVersion": "V8",
     "oauthScopes": [
       "https://www.googleapis.com/auth/spreadsheets",
       "https://www.googleapis.com/auth/drive",
       "https://www.googleapis.com/auth/presentations",
       "https://www.googleapis.com/auth/script.external_request",
       "https://www.googleapis.com/auth/script.scriptapp"
     ],
     "webapp": {
       "executeAs": "USER_DEPLOYING",
       "access": "ANYONE_ANONYMOUS"
     }
   }
   ```
6. Click **Save** (💾).
7. In the dropdown menu at the top of the editor, select `setupExistingData` and click **Run**. Grant the permissions Google asks for.
8. Select `installTriggers` and click **Run**.
9. **Deploy:** Click **Deploy > New deployment**. Select **Web app**. Execute as: **Me**. Who has access: **Anyone**. Click Deploy and copy the Web App URL.

### Step 3: Set up the Frontend (GitHub Pages)
1. Fork this repository to your own GitHub account.
2. Open the `config.js` file in your new repository and click the ✏️ (Edit) pencil.
3. Paste your Web App URL and your `API_SECRET`:
   ```javascript
   window.WEDDING_CONFIG = {
     apiUrl: 'YOUR_URL_HERE',
     secret: 'YOUR_SECRET_HERE'
   };
   ```
4. Go to your repository **Settings > Pages**. Set the branch to `main` and click **Save**.
5. GitHub will give you a URL (e.g., `https://yourusername.github.io/wedding-planner/`). Open it on your phone!

---

## 📱 2. How to Use the App

*   **The Sidebar:** Tap the ☰ icon to open the menu and jump between Budget, Guests, Timeline, etc.
*   **Editing:** Tap the **⋯** (three dots) next to any item to open a mini-form and change prices, dates, or notes.
*   **Checking things off:** Just tap the square checkbox.
*   **Refreshing:** The app saves data for 5 minutes to load fast. If you make a change in the Google Sheet and don't see it on the app, just tap the **Refresh** button in the bottom left.

---

## 🛑 3. The "Golden Rules" & Admin Quirks

The app is smart, but it relies on the Google Sheet being formatted a certain way. If you are the one managing the Google Sheet, please follow these rules to avoid breaking the app:

1.  **Never insert rows above Row 1.** Always insert new rows below the headers.
2.  **Section Headers must be in ALL CAPS.** In the Bridal List, if you type `MKPO`, it becomes a section card. If you type `Mkpo`, it becomes a regular task. (It also recognizes prefixes like `Part 1`, `Section A`, etc.).
3.  **The Budget Mirror Quirk:** The app uses a flat mirror of the Budget (`budget_flat`) to stay fast. If you ever manually **insert or delete an entire row** in the main Budget sheet, you *must* click **⚙️ Workbook Tools > Refresh budget_flat from Budget** in the Google Sheet menu. Otherwise, the app will write to the wrong rows!
4.  **Available Cash Calculation:** The app calculates Available Cash using a Named Range. Make sure a Named Range called `Budget_Total_Deposits` exists in your Budget sheet and points to the single cell containing the total sum of all deposits. 
5.  **Adding Vendors:** To add a new vendor category (e.g., Honeymoon), create a new sheet, add it to the `_app_config` sheet, and put a label in Column P (`vendorKind`). The app will automatically merge it into the Vendors tab.
6.  **The Savings Key:** The app calculates `Available Cash = Savings (from _app_meta) + Cash Contributions - Total Deposits`. Do not use `cash_at_hand` in `_app_meta`; it is ignored.

---

## 💌 4. Generating Invitations (Optional Bonus)

You can generate personalized PDF invitations for every guest directly from the sheet. 

1.  **Create Templates:** Create two Google Slides (one for White, one for TM). In the slides, type `<<Name>>` in a text box where you want the guest's name to go. Ensure it is a real text box on the slide canvas (not a master layout).
2.  **Create Folders:** Create three folders in Google Drive (Email, E-Card, Physical).
3.  **Get IDs:** Copy the IDs from the URLs of your slides and folders.
4.  **Update Code:** Paste those IDs into the Apps Script code inside the `generateInvites` and `generateInviteForSelectedRow` functions.
5.  **Generate:** In Google Sheets, go to **⚙️ Workbook Tools > Generate ALL Guest Invitations**. 
    *   The script will look at the "How to invite" column. If it says `email`, it goes to the Email folder. If it says `e-invite`, it goes to the E-Card folder. Everything else goes to Physical.
    *   It looks at the "Invited to" column to generate a White PDF, a TM PDF, or both.
    *   *(It will safely skip anyone who doesn't have an invite method selected yet!)*

---

## 🔒 Privacy & Security
*   **Your data is yours:** The app has no central server. It talks directly to your private Google Sheet. Your guest list and budget are not stored anywhere else.
*   **The Secret:** Your `API_SECRET` acts as a password. Because this is a public website (GitHub Pages), anyone who views the page source can see the secret. However, the secret *only* allows access to read/write this specific spreadsheet. If a random person stumbles on your GitHub URL, they could theoretically see your guest list, so **keep the URL private** (or just don't share it).
*   **Execute as Me:** The script runs under your Google account. Any changes you make in the web app are securely passed to your Google Sheet. No one else needs to log in or grant permissions.