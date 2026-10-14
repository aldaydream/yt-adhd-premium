# yt-adhd-premium

A browser extension for Microsoft Edge and Google Chrome. It shows up to four YouTube videos at once, right inside the YouTube page, and plays the sound of one of them. You keep scrolling the YouTube feed while the videos play.

The extension appears in the browser as **ADHD MultiView**.

> Works with YouTube. This project is not affiliated with, endorsed by or sponsored by YouTube or Google.

![Four windows in the main position, the feed stays on the right](docs/panel-main.png)

*Screenshot from the offline test page (`npm run e2e`), so the players show placeholders.*

## What it does

- **Stays inside YouTube.** On a watch page the panel takes the place of the YouTube player and comments. The recommendations column on the right keeps scrolling as usual.
- **Click to add.** While the panel is open, a click on any video in the feed, search results or menus adds it to the panel. Ctrl+click, Shift+click and the middle button still open a new tab or window.
- **Up to four windows, several layouts.** Side by side, wide and narrow, top and bottom, one large window with a stack, a 2×2 grid and more, in the spirit of Windows snap layouts and tiling window managers. Drag a window by its handle onto another to swap them. Click the handle, or press Enter on it, to move a window to the next slot.
- **One audio track.** The first video gets the sound. When you add a video while another one is audible, a short prompt asks which sound to keep. The speaker button in each window switches the sound, the volume slider sets the level for every window.
- **Info panel per window.** Each window has a slim strip under the video. The arrow opens the title, the channel and an "Open on YouTube" link; the video in that window shrinks a little to make room.
- **Two positions.** "Main" uses the player and comments area. "Right" puts the windows into the recommendations column and keeps the YouTube player and comments on the left. In this position the YouTube player counts as one more audio source ("Main video").
- **Elsewhere on YouTube** (home page, search, a narrow window) the panel floats in the top right corner.
- **Continues where you were.** The video you were watching moves into the panel at the same moment.
- The set of videos, their order, the layouts, the position and the volume are saved in the browser on this computer.

## Install

The extension is not in any store. Install it as an unpacked extension.

1. Download this repository (Code, then Download ZIP) and unpack it to a folder you keep, or clone it.
2. Open `edge://extensions` in Edge or `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the folder that contains `manifest.json` (`extension/` in this repository).
5. Pin **ADHD MultiView** to the toolbar.

After an update, click **Reload** for the extension on the extensions page and reload the YouTube tab.

## Use

1. Open YouTube and click the ADHD MultiView button. Click it again to close the panel.
2. Click videos in the feed, or paste a link (`watch`, `youtu.be`, `shorts`, `live`, with `t=90` or `t=1m30s`) and press Add.
3. A new video starts by itself only while no other window is playing. Otherwise press ▶ in its player.
4. Pick a layout with the small layout buttons, switch between Main and Right, drag windows to rearrange them.
5. The × in a window closes that window. The × in the toolbar closes the panel and stops every player.

## Permissions and data

| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Adds the panel to the YouTube tab after you click the toolbar button. |
| `storage` | Saves your set of videos, layouts, position and volume in `chrome.storage.local`. |
| `declarativeNetRequestWithHostAccess`, `www.youtube.com`, `www.youtube-nocookie.com` | Identifies the extension to YouTube's embedded player (see below). |

YouTube requires every client of its embedded player to identify itself in the HTTP `Referer` header ([client identity](https://developers.google.com/youtube/terms/required-minimum-functionality#embedded-player-api-client-identity)). Inside youtube.com the embeds would otherwise send `youtube.com` and fail with error 152. While the panel is open, a session rule sets `Referer: https://adhd-multiview.<extension-id>/` for the extension's own embed frames in that tab only. The `key` in `manifest.json` keeps the extension ID stable. The rule is removed when the panel closes, the tab navigates away or closes.

There is no server, no analytics and no tracking. The extension loads the official `https://www.youtube.com/iframe_api` script into the YouTube page and plays videos from `www.youtube-nocookie.com`. YouTube receives the usual player requests.

## YouTube's rules

The panel uses YouTube's official embedded player and follows the player rules it can follow:

- YouTube's own player controls and branding stay visible in every window; nothing is drawn over a player.
- Every player keeps a viewport of at least 200×200 px; when the panel is too small, it scrolls.
- At most one window starts playing by itself at a time; restored sets never autoplay.
- Sound is switched with the documented `mute()`, `unMute()` and `setVolume()` calls.
- Closing the panel stops and removes every player.

Known gap: while the panel is open, the extension changes how youtube.com looks (it hides the YouTube player and comments, or the recommendations column) and turns feed clicks into "add to panel". YouTube's [Developer Policies](https://developers.google.com/youtube/terms/developer-policies) ask API clients not to change YouTube's own interface without approval. This project is meant for personal use and is not submitted to any extension store. This is not legal advice.

## Limits

- Up to four videos. Several streams use more memory and bandwidth.
- Owners can block embedding; private, age-restricted, paid or region-locked videos may not play in a window.
- YouTube changes its page often. If the panel lands in the wrong place after a YouTube update, please open an issue.
- Tested offline against a mock of YouTube's page structure and player API, plus a manual check of the page structure on youtube.com. Real playback depends on YouTube.

## Development

No build step and no runtime dependencies.

```text
npm test          # unit tests (Node 20+)
npm run check     # manifest, permissions, syntax, icons
npm run e2e       # offline end-to-end test in Chromium; needs Playwright, openssl and port 443
npm run package   # ZIP for manual installation
```

Code map: `extension/background.js` (toolbar button, network rule), `extension/content.js` (panel UI, isolated world), `extension/page-bridge.js` (YouTube IFrame API, page world), `extension/core.js` (link parsing, layouts, audio coordination).

## License

MIT, see [LICENSE](LICENSE).
