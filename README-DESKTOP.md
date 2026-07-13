# Focus Tracker — Mac desktop app

This wraps your Focus Tracker web app in [Electron](https://www.electronjs.org/)
so it runs as a real Mac app: its own window, its own Dock icon, launchable
like any other app — no browser tab required.

It reuses the same Supabase + Google Calendar setup as the web version, just
served locally instead of from a browser tab.

## 1. Install Node.js (skip if you already have it)

Check first:
```bash
node -v
```
If that fails, install Node from [nodejs.org](https://nodejs.org) (LTS version).

## 2. Install dependencies

From inside this `focus-tracker-desktop` folder:
```bash
npm install
```

## 3. Set up Supabase + Google Calendar

Same as the web version:

1. **Supabase**: create a project at [supabase.com](https://supabase.com), run
   `schema.sql` (included here) in the SQL Editor, then copy your **Project
   URL** and **anon public key** into `app-files/config.js`.
2. Under **Authentication → URL Configuration** in Supabase, add
   `http://localhost:51739` to **Redirect URLs**.
3. **Google Cloud**: create an OAuth client (Web application type), enable
   the Calendar API, add yourself as a test user, and add
   `http://localhost:51739` (exact match, no trailing slash) to
   **Authorized JavaScript origins**. Copy the Client ID into
   `app-files/config.js`.
4. In Supabase, since this app signs in with a typed 6-digit code rather than
   a clicked link (more reliable inside a desktop window), open
   **Authentication → Email Templates → Magic Link** and make sure the
   template includes `{{ .Token }}` somewhere in the body — that's the code
   that gets emailed to you. (The default template usually already includes
   it; just double check.)

`app-files/config.js` should end up looking like:
```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",
  GOOGLE_CLIENT_ID: "xxxxxxxx.apps.googleusercontent.com"
};
```

## 4. Try it

```bash
npm start
```
A window titled "Focus." should open. Sign in with your email, grab the
6-digit code from your inbox, and you're in.

## 5. Build a real Mac app

```bash
npm run build
```
This produces a `.dmg` inside the `dist/` folder. Open it, drag **Focus
Tracker.app** into your **Applications** folder, then drag it onto your Dock
for one-click daily access.

**First launch note:** since this isn't signed with an Apple Developer
certificate, macOS Gatekeeper will likely say it's from an "unidentified
developer" the first time. Right-click the app → **Open** → **Open** again
in the dialog — you only need to do this once.

## Daily use

After that first setup, just click the Dock icon like any other app. It
keeps its own native window, remembers your sign-in (Supabase sessions
persist), and works exactly like the web version — task list, Pomodoro
runs, streaks, calendar — just without a browser around it.

## If you want to tweak the port

The app runs a tiny local server on port `51739` so it can load its files
and talk to Supabase/Google properly (some things don't work over a plain
`file://` path). If `51739` is ever in use by something else on your Mac,
change the `PORT` constant at the top of `main.js` — and update the matching
origin/redirect URL in Google Cloud and Supabase to match.

## Files

| File | Purpose |
|---|---|
| `main.js` | Electron entry point — runs a local server and opens the window |
| `package.json` | Electron app config + build script |
| `app-files/` | The actual web app (same as the standalone web version) |
| `schema.sql` | Database schema — run once in Supabase's SQL editor |
