(function () {
  "use strict";

  if (globalThis.__YT_MULTI_VIEW_CONTENT_INSTALLED__) return;
  const Core = globalThis.YTMultiViewCore;
  if (!Core) throw new Error("YouTube MultiView core is missing.");
  globalThis.__YT_MULTI_VIEW_CONTENT_INSTALLED__ = true;

  const CHANNEL = "YT_MULTI_VIEW_V1";
  const STORAGE_KEY = "ytMultiViewSession";
  const ROOT_ID = "yt-multiview-root";
  const STYLE_ID = "yt-multiview-page-style";
  const PAGE = "page";
  const AREAS = "abcd";
  const GAP = 12;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PLAYER_STATES = new Map([
    [-1, "Press ▶ in the player"], [0, "Ended"], [1, "Playing"], [2, "Paused"], [3, "Buffering"],
    [5, "Press ▶ in the player"], ["blocked", "Autoplay was blocked. Press ▶ in the player."]
  ]);
  const ICONS = {
    grip: ["M9 6h.01", "M15 6h.01", "M9 12h.01", "M15 12h.01", "M9 18h.01", "M15 18h.01"],
    audioOn: ["M4 9v6h4l5 4V5L8 9H4z", "M16 9a4 4 0 0 1 0 6", "M18.5 6.5a7.5 7.5 0 0 1 0 11"],
    audioOff: ["M4 9v6h4l5 4V5L8 9H4z", "M17 9l5 6", "M22 9l-5 6"],
    chevron: ["M6 15l6-6 6 6"],
    close: ["M6 6l12 12", "M18 6L6 18"],
    external: ["M14 4h6v6", "M20 4l-9 9", "M19 14v5H5V5h5"]
  };
  // Applied to YouTube's own page while the panel is open. Main dock: the panel takes the player and
  // comments column, the recommendations column keeps scrolling. Right dock: the panel takes the
  // recommendations column, YouTube's player and comments stay.
  const PAGE_CSS = `
    html[data-mv-dock="main"] ytd-watch-flexy #player { visibility: hidden !important; }
    html[data-mv-dock="main"] ytd-watch-flexy #full-bleed-container,
    html[data-mv-dock="main"] ytd-watch-flexy #player-full-bleed-container,
    html[data-mv-place="main"] ytd-watch-flexy #below { display: none !important; }
    html[data-mv-dock="main"] ytd-miniplayer { display: none !important; }
    html[data-mv-place="right"] ytd-watch-flexy #secondary-inner { visibility: hidden !important; }
  `;
  let active = null;
  let generation = 0;
  let saveQueue = Promise.resolve();

  const CSS = `
    :host { all: initial; --panel: #181818; --field: #0f0f0f; --card: #212121; --line: #3a3a3a; --text: #f1f1f1; --muted: #aaaaaa;
      --accent: #3ea6ff; --accent-ink: #0f0f0f; --hover: #2c2c2c; --error: #ff8a80; color-scheme: dark; }
    :host([data-theme="light"]) { --panel: #ffffff; --field: #ffffff; --card: #f6f6f6; --line: #d9d9d9; --text: #0f0f0f; --muted: #606060;
      --accent: #065fd4; --accent-ink: #ffffff; --hover: #ececec; --error: #c5221f; color-scheme: light; }
    *, *::before, *::after { box-sizing: border-box; }
    .app { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; background: var(--panel);
      color: var(--text); border: 1px solid var(--line); border-radius: 12px; font: 13px/1.4 Roboto, Arial, sans-serif; }
    :host([data-place="float"]) .app { box-shadow: 0 12px 40px rgba(0,0,0,.45); }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--line); flex: none; }
    .brand { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
    .brand strong { font-size: 14px; font-weight: 500; }
    .count { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    form { display: flex; gap: 6px; flex: 1 1 240px; min-width: 180px; margin: 0; }
    input[type=url] { flex: 1; min-width: 0; height: 32px; padding: 0 12px; border: 1px solid var(--line); border-radius: 16px;
      background: var(--field); color: var(--text); font: inherit; }
    input[type=url]::placeholder { color: var(--muted); }
    input[aria-invalid=true] { border-color: var(--error); }
    button { font: inherit; color: var(--text); cursor: pointer; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 16px;
      border: 1px solid var(--line); background: transparent; white-space: nowrap; }
    .btn:hover:enabled, .icon:hover:enabled, .grip:hover { background: var(--hover); }
    .btn:disabled, .icon:disabled { opacity: .45; cursor: default; }
    .btn.primary { background: var(--text); color: var(--panel); border-color: var(--text); font-weight: 500; }
    .btn.primary:hover:enabled { background: var(--text); opacity: .88; }
    .icon { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 16px; background: transparent; flex: none; }
    svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    .grip svg { stroke-width: 3.2; }
    .group { display: inline-flex; align-items: center; gap: 4px; }
    .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
    .seg button { height: 30px; padding: 0 12px; border: 0; background: transparent; }
    .seg button:hover { background: var(--hover); }
    .seg button[aria-pressed=true], .layout[aria-pressed=true], .btn[aria-pressed=true] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
    .layout { width: 38px; height: 32px; padding: 5px; border: 1px solid var(--line); border-radius: 8px; background: transparent; }
    .layout:hover { background: var(--hover); }
    .mini { display: grid; gap: 2px; width: 100%; height: 100%; }
    .mini span { background: currentColor; opacity: .55; border-radius: 2px; }
    .layout[aria-pressed=true] .mini span { opacity: 1; }
    input[type=range] { width: 84px; accent-color: var(--accent); cursor: pointer; }
    output { min-width: 34px; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    .notice { flex-basis: 100%; margin: 0; color: var(--muted); font-size: 12px; }
    .notice:empty { display: none; }
    .notice.error { color: var(--error); }
    .workspace { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px; overscroll-behavior: contain; }
    .grid { display: grid; gap: 8px; height: 100%; }
    .grid.dragging iframe { pointer-events: none; }
    .card { display: flex; flex-direction: column; min-width: 0; overflow: hidden; background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
    .card[data-selected=true] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
    .card.drop { outline: 2px dashed var(--accent); outline-offset: 2px; }
    .player { position: relative; flex: 1 1 auto; min-width: 200px; min-height: 200px; background: #000; }
    .player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
    .strip { display: flex; align-items: center; gap: 2px; height: 32px; padding: 0 4px; flex: none; }
    .strip .icon { width: 28px; height: 28px; }
    .strip .title { flex: 1; min-width: 0; margin: 0; padding: 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; }
    .grip { cursor: grab; color: var(--muted); }
    .audio[aria-pressed=true] { color: var(--accent); }
    .more svg { transition: transform .15s; }
    .more[aria-expanded=true] svg { transform: rotate(180deg); }
    .details { flex: none; padding: 6px 10px 8px; border-top: 1px solid var(--line); font-size: 12px; }
    .details .full { margin: 0 0 2px; font-weight: 500; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .details .channel { margin: 0; color: var(--muted); }
    .details .meta { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 4px; color: var(--muted); }
    .details a { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); text-decoration: none; white-space: nowrap; }
    .details a:hover { text-decoration: underline; }
    .details a svg { width: 14px; height: 14px; }
    .card-error { margin: 4px 0 0; color: var(--error); overflow-wrap: anywhere; }
    .empty { display: grid; place-items: center; height: 100%; min-height: 200px; padding: 24px; text-align: center; color: var(--muted);
      border: 1px dashed var(--line); border-radius: 10px; }
    .empty strong { display: block; margin-bottom: 4px; color: var(--text); font-size: 15px; font-weight: 500; }
    .chooser { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--line); background: var(--card); }
    .chooser p { margin: 0; font-weight: 500; }
    .chooser button { display: flex; align-items: center; gap: 8px; flex: 1 1 180px; min-width: 0; min-height: 36px; padding: 4px 12px; text-align: left;
      border: 1px solid var(--line); border-radius: 18px; background: transparent; }
    .chooser button:hover { background: var(--hover); }
    .chooser button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chooser small { flex-basis: 100%; color: var(--muted); }
    .only-right { display: none; }
    :host([data-dock="right"][data-page="yes"]) .only-right { display: inline-flex; }
    /* The narrow right column and the floating panel stack windows in one scrolling column. */
    :host(:not([data-place="main"])) .grid { display: flex; flex-direction: column; height: auto; }
    :host(:not([data-place="main"])) .player { flex: none; aspect-ratio: 16 / 9; }
    :host(:not([data-place="main"])) .brand { order: -2; }
    :host(:not([data-place="main"])) .close { order: -1; margin-left: auto; }
    :host(:not([data-place="main"])) form { flex-basis: 100%; }
    /* Pressed controls keep their colours under the pointer. */
    .seg button[aria-pressed=true]:hover, .layout[aria-pressed=true]:hover, .btn[aria-pressed=true]:hover:enabled { background: var(--accent); filter: brightness(1.08); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    /* Focus rings in a window strip stay inside the strip, clear of the player above it. */
    .strip :focus-visible { outline-offset: -2px; }
    [hidden] { display: none !important; }
    @media (prefers-reduced-motion: reduce) { .more svg { transition: none; } }
  `;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    for (const d of ICONS[name]) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    return svg;
  }

  function button(className, text, label) {
    const node = element("button", className, text);
    node.type = "button";
    if (label) { node.setAttribute("aria-label", label); node.title = label; }
    return node;
  }

  function iconButton(className, name, label) {
    const node = button("icon " + className, undefined, label);
    node.append(icon(name));
    return node;
  }

  function setIcon(node, name) {
    node.replaceChildren(icon(name));
  }

  function currentSession(session) {
    return active === session && session.generation === generation && session.root.isConnected;
  }

  function postCommand(session, command, payload) {
    window.postMessage({ channel: CHANNEL, kind: "command", sessionId: session.sessionId, command, payload }, location.origin);
  }

  function setNotice(session, message, isError = false) {
    if (!currentSession(session)) return;
    clearTimeout(session.noticeTimer);
    session.notice.textContent = message;
    session.notice.classList.toggle("error", isError);
    session.notice.setAttribute("role", isError ? "alert" : "status");
    if (message) session.noticeTimer = setTimeout(() => { if (currentSession(session)) session.notice.textContent = ""; }, isError ? 10000 : 6000);
  }

  function save(session) {
    const snapshot = { videos: session.videos.map(video => ({ ...video })), volume: session.volume, dock: session.dock, layouts: { ...session.layouts } };
    saveQueue = saveQueue.catch(() => {}).then(() => chrome.storage.local.set({ [STORAGE_KEY]: snapshot })).catch(() => {
      setNotice(session, "Could not save the set. The videos stay available while this tab is open.", true);
    });
  }

  function pageVideoId() {
    if (location.pathname !== "/watch") return null;
    try { return Core.parseVideoUrl(location.href).videoId; } catch (_) { return null; }
  }

  function ensurePageStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = element("style");
    style.id = STYLE_ID;
    style.textContent = PAGE_CSS;
    (document.head || document.documentElement).append(style);
  }

  function setPageAttribute(name, value) {
    const html = document.documentElement;
    if (value === null) delete html.dataset[name];
    else if (html.dataset[name] !== value) html.dataset[name] = value;
  }

  function computePlace(session) {
    const top = Math.round((document.getElementById("masthead-container")?.getBoundingClientRect().bottom || 56) + GAP);
    const viewWidth = document.documentElement.clientWidth || innerWidth;
    const height = Math.max(260, innerHeight - top - GAP);
    const flexy = document.querySelector("ytd-watch-flexy");
    if (location.pathname === "/watch" && flexy && !flexy.hidden && flexy.hasAttribute("is-two-columns_")) {
      const anchor = document.querySelector(session.dock === "right" ? "ytd-watch-flexy #secondary-inner" : "ytd-watch-flexy #primary-inner");
      const box = anchor?.getBoundingClientRect();
      if (box && box.width >= 240) {
        // The panel starts where its column starts (below a theater-mode player) and sticks under the masthead.
        const columnTop = Math.max(top, Math.round(box.top));
        return { mode: session.dock, left: Math.round(box.left), top: columnTop, width: Math.round(box.width), height: Math.max(260, innerHeight - columnTop - GAP) };
      }
    }
    // Any other page, or a single-column watch page: a floating panel over the top right of the page,
    // kept above YouTube's miniplayer.
    const mini = document.querySelector("ytd-miniplayer")?.getBoundingClientRect();
    const bottom = mini && mini.width > 0 && mini.height > 0 ? Math.min(innerHeight, mini.top) - GAP : innerHeight - GAP;
    const width = Math.round(Math.min(640, Math.max(360, viewWidth * 0.42)));
    return { mode: "float", left: Math.max(0, viewWidth - width - GAP), top, width, height: Math.round(Math.max(260, Math.min(bottom - top, width * 0.85))) };
  }

  function place(session) {
    if (!currentSession(session)) return;
    ensurePageStyle();
    session.root.dataset.theme = document.documentElement.hasAttribute("dark") ? "dark" : "light";
    const next = computePlace(session);
    setPageAttribute("mvPlace", next.mode);
    setPageAttribute("mvDock", session.dock);
    const key = [next.mode, next.left, next.top, next.width, next.height].join();
    if (key === session.placeKey) return;
    session.placeKey = key;
    Object.assign(session.root.style, { left: next.left + "px", top: next.top + "px", width: next.width + "px", height: next.height + "px" });
    const modeChanged = session.place !== next.mode;
    session.place = next.mode;
    session.root.dataset.place = next.mode;
    if (modeChanged) applyLayout(session);
  }

  function close(sendStop = true) {
    const session = active;
    if (!session) return;
    generation += 1;
    active = null;
    clearInterval(session.placeTimer);
    clearTimeout(session.noticeTimer);
    window.removeEventListener("scroll", session.onScroll);
    if (sendStop) postCommand(session, "stop", {});
    session.root.remove();
    setPageAttribute("mvPlace", null);
    setPageAttribute("mvDock", null);
    try { chrome.runtime.sendMessage({ type: "MV_RELEASE" }).catch(() => {}); } catch (_) { /* Extension reloads can invalidate the old context. */ }
  }

  function titleOf(session, id) {
    if (id === PAGE) return "Main video";
    return session.cards.get(id)?.title.textContent || "Video";
  }

  function renderLayouts(session, count, currentId) {
    const box = session.layoutBox;
    const hadFocus = box.contains(session.shadow.activeElement);
    box.replaceChildren();
    box.hidden = session.place !== "main" || count < 2;
    if (box.hidden) return;
    for (const layout of Core.LAYOUTS[count]) {
      const option = button("layout", undefined, "Layout: " + layout.label);
      option.setAttribute("aria-pressed", String(layout.id === currentId));
      const mini = element("span", "mini");
      mini.style.gridTemplateAreas = layout.areas;
      mini.style.gridTemplateColumns = layout.cols;
      mini.style.gridTemplateRows = layout.rows;
      for (let index = 0; index < count; index += 1) {
        const cell = element("span");
        cell.style.gridArea = AREAS[index];
        mini.append(cell);
      }
      option.append(mini);
      option.addEventListener("click", () => {
        if (!currentSession(session)) return;
        session.layouts[count] = layout.id;
        applyLayout(session);
        save(session);
      });
      box.append(option);
      if (hadFocus && layout.id === currentId) option.focus();
    }
  }

  function applyLayout(session) {
    const count = session.videos.length;
    const stacked = session.place !== "main";
    const layout = Core.layoutFor(count, session.layouts[count]);
    const grid = session.grid;
    grid.dataset.count = String(count);
    grid.hidden = count === 0;
    if (stacked || count === 0) {
      grid.style.gridTemplateAreas = grid.style.gridTemplateColumns = grid.style.gridTemplateRows = "";
    } else {
      // Every embedded player keeps a viewport of at least 200x200. When the panel is too small, it scrolls.
      grid.style.gridTemplateAreas = layout.areas;
      grid.style.gridTemplateColumns = layout.cols.split(" ").map(size => `minmax(202px, ${size})`).join(" ");
      grid.style.gridTemplateRows = layout.rows.split(" ").map(size => `minmax(min-content, ${size})`).join(" ");
    }
    session.videos.forEach((video, index) => {
      const card = session.cards.get(video.id);
      card.element.style.gridArea = stacked ? "" : AREAS[index];
      card.element.style.order = String(index);
      if (!card.titleKnown) card.title.textContent = "Video " + (index + 1);
      card.title.title = card.title.textContent;
      card.iframe.title = "YouTube player: " + card.title.textContent;
      card.remove.setAttribute("aria-label", "Close " + card.title.textContent);
      card.handle.setAttribute("aria-label", "Move " + card.title.textContent + " to the next window. Drag it onto another window to swap.");
    });
    session.count.textContent = count + "/" + Core.MAX_VIDEOS;
    session.empty.hidden = count !== 0;
    session.addButton.disabled = !session.initialized || count >= Core.MAX_VIDEOS;
    renderLayouts(session, count, layout.id);
    updateAudio(session);
  }

  function updateAudio(session) {
    for (const [id, card] of session.cards) {
      const selected = id === session.selectedId;
      card.element.dataset.selected = String(selected);
      card.audio.setAttribute("aria-pressed", String(selected));
      card.audio.setAttribute("aria-label", selected ? "Audio is on for " + card.title.textContent + ". Click to mute." : "Listen to " + card.title.textContent);
      card.audio.title = selected ? "Audio on" : "Listen to this video";
      setIcon(card.audio, selected ? "audioOn" : "audioOff");
    }
    session.mainAudio.setAttribute("aria-pressed", String(session.selectedId === PAGE));
    session.muteButton.disabled = session.selectedId === null;
    session.volumeInput.value = String(session.volume);
    session.volumeOutput.textContent = session.volume + "%";
    session.volumeInput.setAttribute("aria-valuetext", session.volume + " percent");
    for (const option of session.dockButtons) option.setAttribute("aria-pressed", String(option.dataset.dock === session.dock));
    session.root.dataset.dock = session.dock;
    updateChooser(session);
  }

  function selectAudio(session, id) {
    if (!currentSession(session)) return;
    const card = session.cards.get(id);
    if (id !== null && id !== PAGE && (!card || card.failed)) return;
    if (card && !card.ready) { session.autoAudio = id; return; }
    postCommand(session, "select", { id });
  }

  function showChooser(session, video) {
    session.chooserFor = video.id;
    session.chooser.hidden = false;
    updateChooser(session);
    session.chooserKeep.focus({ preventScroll: true });
  }

  function hideChooser(session) {
    session.chooserFor = null;
    session.chooser.hidden = true;
  }

  function updateChooser(session) {
    if (session.chooser.hidden) return;
    if (!session.cards.has(session.chooserFor)) { hideChooser(session); return; }
    session.chooserKeep.lastChild.textContent = session.selectedId === null ? "Keep silence" : "Keep: " + titleOf(session, session.selectedId);
    session.chooserSwitch.lastChild.textContent = "Switch to: " + titleOf(session, session.chooserFor);
  }

  function chooseAudio(session, switchToNew) {
    const id = session.chooserFor;
    hideChooser(session);
    if (switchToNew && id) selectAudio(session, id);
  }

  function moveVideo(session, fromId, toId) {
    const from = session.videos.findIndex(video => video.id === fromId);
    const to = session.videos.findIndex(video => video.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    [session.videos[from], session.videos[to]] = [session.videos[to], session.videos[from]];
    // Only CSS grid areas change. Moving the iframes in the DOM would reload the players.
    applyLayout(session);
    save(session);
  }

  function removeVideo(session, id) {
    if (!currentSession(session)) return;
    const index = session.videos.findIndex(video => video.id === id);
    if (index < 0) return;
    postCommand(session, "remove", { id });
    session.videos.splice(index, 1);
    session.cards.get(id).element.remove();
    session.cards.delete(id);
    if (session.autoAudio === id) session.autoAudio = null;
    if (session.chooserFor === id) hideChooser(session);
    applyLayout(session);
    save(session);
    const next = session.videos[Math.min(index, session.videos.length - 1)];
    if (next) session.cards.get(next.id).remove.focus();
    else session.urlInput.focus();
  }

  function createCard(session, video) {
    const cardElement = element("article", "card");
    cardElement.dataset.selected = "false";
    const player = element("div", "player");
    const iframe = element("iframe");
    iframe.id = "yt-multiview-" + video.id;
    iframe.dataset.mvId = video.id;
    iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
    iframe.setAttribute("allowfullscreen", "");
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    player.append(iframe);

    const strip = element("footer", "strip");
    // A span: Chromium does not start HTML drag and drop from a <button>.
    const handle = element("span", "icon grip");
    handle.append(icon("grip"));
    handle.setAttribute("role", "button");
    handle.tabIndex = 0;
    handle.draggable = true;
    handle.title = "Drag onto another window to swap. Click to move to the next window.";
    const audio = iconButton("audio", "audioOff", "Listen to this video");
    audio.disabled = true;
    const title = element("h2", "title", "Video");
    const more = iconButton("more", "chevron", "Show title and channel");
    more.setAttribute("aria-expanded", "false");
    const remove = iconButton("remove", "close", "Close this window");
    strip.append(handle, audio, title, more, remove);

    const details = element("div", "details");
    details.hidden = true;
    details.id = "mv-details-" + video.id;
    more.setAttribute("aria-controls", details.id);
    const fullTitle = element("p", "full", "Loading the player…");
    const channel = element("p", "channel", "");
    const meta = element("div", "meta");
    const state = element("span", "state", "Loading…");
    const link = element("a", "", "Open on YouTube");
    link.href = video.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.append(icon("external"));
    meta.append(state, link);
    const error = element("p", "card-error");
    error.hidden = true;
    error.setAttribute("role", "alert");
    details.append(fullTitle, channel, meta, error);

    cardElement.append(player, strip, details);
    const card = { element: cardElement, title, fullTitle, channel, titleKnown: false, iframe, state, audio, more, handle, remove, details, error, ready: false, failed: false };
    session.cards.set(video.id, card);
    session.grid.append(cardElement);

    audio.addEventListener("click", () => selectAudio(session, session.selectedId === video.id ? null : video.id));
    remove.addEventListener("click", () => removeVideo(session, video.id));
    more.addEventListener("click", () => {
      const open = details.hidden;
      details.hidden = !open;
      more.setAttribute("aria-expanded", String(open));
      more.setAttribute("aria-label", open ? "Hide title and channel" : "Show title and channel");
      more.title = more.getAttribute("aria-label");
    });
    const moveNext = () => {
      const index = session.videos.findIndex(entry => entry.id === video.id);
      const next = session.videos[(index + 1) % session.videos.length];
      if (next) moveVideo(session, video.id, next.id);
      handle.focus();
    };
    handle.addEventListener("click", moveNext);
    handle.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); moveNext(); }
    });
    handle.addEventListener("dragstart", event => {
      session.dragId = video.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", video.id);
      session.grid.classList.add("dragging");
    });
    handle.addEventListener("dragend", () => {
      session.dragId = null;
      session.grid.classList.remove("dragging");
      for (const other of session.cards.values()) other.element.classList.remove("drop");
    });
    cardElement.addEventListener("dragover", event => {
      if (!session.dragId || session.dragId === video.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      cardElement.classList.add("drop");
    });
    cardElement.addEventListener("dragleave", event => {
      if (!cardElement.contains(event.relatedTarget)) cardElement.classList.remove("drop");
    });
    cardElement.addEventListener("drop", event => {
      event.preventDefault();
      cardElement.classList.remove("drop");
      if (session.dragId) moveVideo(session, session.dragId, video.id);
    });
    return card;
  }

  /** Adds a parsed video. The first audible video gets the audio; later ones ask which audio to keep. */
  function addVideo(session, parsed, autoplay) {
    if (!currentSession(session) || !session.initialized) return false;
    if (session.videos.some(video => video.videoId === parsed.videoId)) {
      setNotice(session, "This video is already in the panel.");
      return false;
    }
    if (session.videos.length >= Core.MAX_VIDEOS) {
      setNotice(session, "All four windows are in use. Close one to add this video.", true);
      return false;
    }
    const video = { id: "mv-" + crypto.randomUUID(), ...parsed };
    const someoneAudible = session.selectedId !== null || session.autoAudio !== null;
    session.videos.push(video);
    const card = createCard(session, video);
    applyLayout(session);
    revealCard(session, card);
    // The bridge starts it only while no other window plays (one automatically playing player per page).
    postCommand(session, "add", { video, autoplay });
    if (someoneAudible) showChooser(session, video);
    else session.autoAudio = video.id;
    save(session);
    return true;
  }

  function revealCard(session, card) {
    const view = session.workspace.getBoundingClientRect();
    const box = card.element.getBoundingClientRect();
    if (box.bottom > view.bottom) session.workspace.scrollTop += box.bottom - view.bottom + 8;
    else if (box.top < view.top) session.workspace.scrollTop -= view.top - box.top + 8;
  }

  function addFromField(session) {
    if (!currentSession(session) || !session.initialized) return;
    try {
      const parsed = Core.parseVideoUrl(session.urlInput.value);
      if (addVideo(session, parsed, true)) {
        session.urlInput.value = "";
        session.urlInput.removeAttribute("aria-invalid");
      }
    } catch (error) {
      session.urlInput.setAttribute("aria-invalid", "true");
      setNotice(session, error.message || "Could not add the video.", true);
    }
    session.urlInput.focus();
  }

  function setDock(session, dock) {
    if (!currentSession(session) || session.dock === dock) return;
    session.dock = dock;
    postCommand(session, "dock", { dock });
    session.placeKey = "";
    place(session);
    updateAudio(session);
    save(session);
  }

  function createInterface(session) {
    const shadow = session.root.attachShadow({ mode: "open" });
    const style = element("style");
    style.textContent = CSS;
    const app = element("section", "app");
    app.setAttribute("role", "region");
    app.setAttribute("aria-label", "YouTube MultiView");

    const toolbar = element("header", "toolbar");
    const brand = element("div", "brand");
    const count = element("span", "count", "0/4");
    brand.append(element("strong", "", "MultiView"), count);

    const form = element("form");
    form.noValidate = true;
    const label = element("label", "sr-only", "YouTube video link");
    label.htmlFor = "mv-video-url";
    const urlInput = element("input");
    urlInput.id = "mv-video-url";
    urlInput.type = "url";
    urlInput.placeholder = "Paste a link, or click a video in the feed";
    urlInput.autocomplete = "off";
    urlInput.spellcheck = false;
    urlInput.maxLength = 4096;
    urlInput.setAttribute("aria-describedby", "mv-notice");
    const addButton = button("btn primary", "Add");
    addButton.type = "submit";
    addButton.disabled = true;
    form.append(label, urlInput, addButton);
    form.addEventListener("submit", event => { event.preventDefault(); addFromField(session); });
    urlInput.addEventListener("input", () => urlInput.removeAttribute("aria-invalid"));

    const layoutBox = element("div", "group layouts");
    layoutBox.setAttribute("role", "group");
    layoutBox.setAttribute("aria-label", "Layout");

    const dockGroup = element("div", "seg");
    dockGroup.setAttribute("role", "group");
    dockGroup.setAttribute("aria-label", "Panel position");
    const dockButtons = [
      ["main", "Main", "Panel in place of the YouTube player and comments"],
      ["right", "Right", "Panel in the recommendations column, next to the YouTube player"]
    ].map(([dock, text, hint]) => {
      const option = button("", text);
      option.dataset.dock = dock;
      option.title = hint;
      option.addEventListener("click", () => setDock(session, dock));
      dockGroup.append(option);
      return option;
    });

    const mainAudio = button("btn only-right", "Main video", "Listen to the YouTube player on the left");
    mainAudio.prepend(icon("audioOn"));
    mainAudio.addEventListener("click", () => selectAudio(session, session.selectedId === PAGE ? null : PAGE));

    const volumeGroup = element("div", "group");
    const volumeLabel = element("label", "sr-only", "Volume");
    volumeLabel.htmlFor = "mv-volume";
    const volumeInput = element("input");
    volumeInput.id = "mv-volume";
    volumeInput.type = "range";
    volumeInput.min = "0";
    volumeInput.max = "100";
    volumeInput.step = "1";
    const volumeOutput = element("output", "", "70%");
    volumeOutput.htmlFor = "mv-volume";
    volumeInput.addEventListener("input", () => {
      if (!currentSession(session) || !session.initialized) return;
      session.volume = Number(volumeInput.value);
      updateAudio(session);
      postCommand(session, "volume", { volume: session.volume });
      save(session);
    });
    const muteButton = iconButton("", "audioOff", "Mute all");
    muteButton.disabled = true;
    muteButton.addEventListener("click", () => selectAudio(session, null));
    volumeGroup.append(volumeLabel, muteButton, volumeInput, volumeOutput);

    const closeButton = iconButton("close", "close", "Close MultiView");
    closeButton.addEventListener("click", () => close());

    const notice = element("p", "notice");
    notice.id = "mv-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    toolbar.append(brand, form, layoutBox, dockGroup, mainAudio, volumeGroup, closeButton, notice);

    const workspace = element("main", "workspace");
    const grid = element("div", "grid");
    grid.hidden = true;
    const empty = element("div", "empty");
    const emptyText = element("div");
    emptyText.append(element("strong", "", "Add up to four videos"), element("span", "", "Click any video in the YouTube feed, or paste a link above."));
    empty.append(emptyText);
    workspace.append(grid, empty);

    const chooser = element("div", "chooser");
    chooser.hidden = true;
    chooser.setAttribute("role", "dialog");
    chooser.setAttribute("aria-label", "Choose the audio");
    const chooserKeep = button("");
    chooserKeep.append(icon("audioOn"), element("span"));
    const chooserSwitch = button("");
    chooserSwitch.append(icon("audioOn"), element("span"));
    chooserKeep.addEventListener("click", () => chooseAudio(session, false));
    chooserSwitch.addEventListener("click", () => chooseAudio(session, true));
    chooser.append(element("p", "", "Which audio do you want to hear?"), chooserKeep, chooserSwitch, element("small", "", "Esc keeps the current audio."));

    app.append(toolbar, chooser, workspace);
    shadow.append(style, app);
    app.addEventListener("keydown", event => {
      if (event.key === "Escape" && !chooser.hidden) { event.preventDefault(); chooseAudio(session, false); }
    });
    Object.assign(session, { shadow, app, workspace, count, urlInput, addButton, layoutBox, dockButtons, mainAudio, volumeInput, volumeOutput,
      muteButton, notice, grid, empty, chooser, chooserKeep, chooserSwitch });
    updateAudio(session);
  }

  async function open() {
    if (active) return;
    // A panel left by a reloaded extension: remove it. Its bridge sees the missing root and stops its players.
    const stale = document.getElementById(ROOT_ID);
    if (stale) {
      stale.remove();
      try { chrome.runtime.sendMessage({ type: "MV_RELEASE" }).catch(() => {}); } catch (_) { /* context may be gone */ }
      return;
    }
    const root = element("div");
    root.id = ROOT_ID;
    root.style.cssText = "position:fixed;z-index:2010;display:block;left:0;top:0;width:0;height:0;";
    // YouTube page hotkeys (k, j, l, t, f, i, /) would see keys typed in the panel and drive the page player.
    for (const type of ["keydown", "keypress", "keyup"]) root.addEventListener(type, event => event.stopPropagation());
    const session = {
      root, sessionId: crypto.randomUUID(), generation: ++generation, videos: [], cards: new Map(), selectedId: null, volume: 70,
      dock: "main", layouts: {}, initialized: false, place: null, placeKey: "", autoAudio: null, chooserFor: null, dragId: null
    };
    active = session;
    createInterface(session);
    document.documentElement.append(root);
    place(session);
    session.placeTimer = setInterval(() => place(session), 300);
    session.onScroll = () => place(session);
    window.addEventListener("scroll", session.onScroll, { passive: true });
    let saved;
    let storageFailed = false;
    try {
      // Finish earlier writes before a fast close/reopen reads the saved session.
      await saveQueue;
      saved = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    } catch (_) { storageFailed = true; }
    if (!currentSession(session)) return;
    const normalized = Core.normalizeSession(saved);
    Object.assign(session, { videos: normalized.videos, volume: normalized.volume, dock: normalized.dock, layouts: normalized.layouts });
    let setFull = false;
    const watching = pageVideoId();
    if (watching && session.dock === "main") {
      // The video on this page moves into the panel and keeps its audio.
      const current = Core.parseVideoUrl(location.href);
      const existing = session.videos.find(video => video.videoId === current.videoId);
      if (existing) Object.assign(existing, current);
      else if (session.videos.length < Core.MAX_VIDEOS) session.videos.unshift({ id: "mv-" + crypto.randomUUID(), ...current });
      else setFull = true;
      session.autoAudio = session.videos.find(video => video.videoId === watching)?.id || null;
    } else if (session.videos.length === 1 && !(session.dock === "right" && watching)) session.autoAudio = session.videos[0].id;
    for (const video of session.videos) createCard(session, video);
    session.initialized = true;
    session.placeKey = "";
    place(session);
    applyLayout(session);
    setNotice(session, storageFailed ? "Could not read the saved set. Add videos again."
      : setFull ? "All four windows are in use, so this page's video was not added."
      : "", storageFailed || setFull);
    postCommand(session, "start", { videos: session.videos, volume: session.volume, dock: session.dock });
    save(session);
  }

  function validPayload(payload) {
    return payload && typeof payload === "object" && !Array.isArray(payload);
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || !active) return;
    const message = event.data;
    if (!validPayload(message) || message.channel !== CHANNEL || message.kind !== "event" || message.sessionId !== active.sessionId || !validPayload(message.payload)) return;
    const session = active;
    const payload = message.payload;
    const card = typeof payload.id === "string" ? session.cards.get(payload.id) : null;
    switch (message.event) {
      case "ready":
        if (!card || typeof payload.title !== "string" || payload.title.length > 512 || typeof payload.author !== "string" || payload.author.length > 256) return;
        card.ready = true;
        card.audio.disabled = false;
        card.state.textContent = PLAYER_STATES.get(-1);
        if (payload.title.trim()) {
          card.title.textContent = payload.title.trim();
          card.titleKnown = true;
        }
        card.fullTitle.textContent = card.title.textContent;
        card.channel.textContent = payload.author.trim();
        if (session.autoAudio === payload.id) {
          session.autoAudio = null;
          postCommand(session, "select", { id: payload.id });
        }
        applyLayout(session);
        break;
      case "state":
        if (!card || !PLAYER_STATES.has(payload.state)) return;
        card.state.textContent = PLAYER_STATES.get(payload.state);
        break;
      case "audio":
        if (payload.id !== null && payload.id !== PAGE && !session.cards.has(payload.id)) return;
        if (typeof payload.volume !== "number" || !Number.isInteger(payload.volume) || payload.volume < 0 || payload.volume > 100) return;
        session.selectedId = payload.id;
        session.volume = payload.volume;
        session.root.dataset.page = payload.page === true ? "yes" : "no";
        updateAudio(session);
        break;
      case "error":
        if (typeof payload.message !== "string" || !payload.message || payload.message.length > 2048) return;
        if (payload.id !== null && !card) return;
        if (card) {
          card.ready = false;
          card.failed = true;
          if (session.chooserFor === payload.id) hideChooser(session);
          card.audio.disabled = true;
          card.error.textContent = payload.message;
          card.error.hidden = false;
          card.state.textContent = "Unavailable";
          card.details.hidden = false;
          card.more.setAttribute("aria-expanded", "true");
          if (session.autoAudio === payload.id) session.autoAudio = null;
        } else setNotice(session, payload.message, true);
        break;
      case "resume": {
        // Switching to the main position: the page video moves into the panel.
        if (typeof payload.videoId !== "string" || !Number.isSafeInteger(payload.time) || payload.time < 0) return;
        let parsed;
        try { parsed = Core.parseVideoUrl("https://www.youtube.com/watch?v=" + payload.videoId + (payload.time ? "&t=" + payload.time : "")); } catch (_) { return; }
        if (!session.videos.some(video => video.videoId === parsed.videoId)) addVideo(session, parsed, payload.playing === true);
        break;
      }
      case "closed": close(false); break;
      default: break;
    }
  });

  // While the panel is open, a plain click on a video anywhere on YouTube adds it to the panel.
  // Ctrl, Shift, Alt, Cmd and middle clicks keep their usual meaning (new tab, new window).
  window.addEventListener("click", event => {
    const session = active;
    if (!session || !session.initialized || !event.isTrusted || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const path = event.composedPath();
    if (path.includes(session.root)) return;
    const index = path.findIndex(node => node instanceof HTMLAnchorElement && node.href);
    if (index < 0) return;
    // Buttons inside a thumbnail (Watch later, Add to queue, preview controls) keep their own action.
    if (path.slice(0, index).some(node => node instanceof Element && node.matches("button, [role=button], input, select, textarea"))) return;
    let parsed;
    try { parsed = Core.parseVideoUrl(path[index].href); } catch (_) { return; }
    // With the panel on the right, timestamps and chapters of the page's own video keep working.
    if (session.dock === "right" && parsed.videoId === pageVideoId()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    addVideo(session, parsed, true);
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message || message.type !== "MV_TOGGLE" || sender.id !== chrome.runtime.id) return;
    respond({ ok: true });
    if (active) close();
    else open().catch(() => {
      if (active) setNotice(active, "MultiView could not open. Close it and try again.", true);
    });
  });
})();
