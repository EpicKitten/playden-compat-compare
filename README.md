# playden-compat-compare

A static web page that checks your Steam library against the
[Playden PS5 compatibility list](https://github.com/leolobato/playden-ps5/blob/main/COMPATIBILITY.md).

Paste a Steam profile link (`https://steamcommunity.com/id/yourname`, `/profiles/7656…`, a custom URL name or a
SteamID64) and it shows every game you own that has a compatibility report: status, kit, engine and notes. Games
you own that nobody has reported yet are listed separately, with a link to open a test report.

## How it works

- **Compatibility list:** fetched live from
  `raw.githubusercontent.com/leolobato/playden-ps5/refs/heads/main/COMPATIBILITY.md` and parsed from the
  `## Games` table. Rows are matched by Steam app ID from the store link; rows without a Steam link (imported
  copies) are matched by name.
- **Steam library:** Steam doesn't allow browsers to read its pages from other sites (no CORS), so the page fetches
  your public games page (`/games/?tab=all`) through a public CORS proxy, trying each in turn. If that fails it tries
  the legacy XML games list, then the Steam Web API if you've entered a key under *Connection settings*.
- **Paste manually:** if every proxy fails, open your games page, view source, and paste it in. A
  `GetOwnedGames` JSON response, store links, or a plain list of game names also work.

Your Steam profile and **Game details** must be public. Nothing is stored except your last profile, custom proxy list
and optional API key, in your browser's local storage. Links like `?profile=https://steamcommunity.com/id/yourname`
run the check on load.

## Deploying

The `Deploy to GitHub Pages` workflow publishes the site on every push to `main`. In the repository's
**Settings › Pages**, set **Source** to **GitHub Actions** once. Alternatively, choose *Deploy from a branch* and
pick `main` / root: the site is plain HTML, CSS and JS with no build step.

To run it locally, serve the folder with any static server, for example `python3 -m http.server`.
