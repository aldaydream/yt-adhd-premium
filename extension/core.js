(function (root) {
  "use strict";

  const MAX_VIDEOS = 4;
  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  const CARD_ID = /^[A-Za-z0-9_-]{1,64}$/;
  const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
  const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
  const EMBED_HOSTS = new Set(["youtube-nocookie.com", "www.youtube-nocookie.com"]);

  function validSeconds(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function parseTime(value) {
    if (typeof value !== "string" || !value) {
      throw new Error("Use a start time in seconds or as 1h2m3s.");
    }
    if (/^\d+$/.test(value)) {
      const seconds = Number(value);
      if (validSeconds(seconds)) return seconds;
    } else {
      const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
      if (parts && (parts[1] || parts[2] || parts[3])) {
        const seconds = Number(parts[1] || 0) * 3600 + Number(parts[2] || 0) * 60 + Number(parts[3] || 0);
        if (validSeconds(seconds)) return seconds;
      }
    }
    throw new Error("Invalid start time. Use seconds or 1h2m3s.");
  }

  function canonicalVideo(videoId, startSeconds) {
    return {
      videoId,
      startSeconds,
      url: "https://www.youtube.com/watch?v=" + videoId + (startSeconds ? "&t=" + startSeconds + "s" : "")
    };
  }

  function parseVideoUrl(input) {
    if (typeof input !== "string" || !input.trim() || input.length > 4096) {
      throw new Error("Paste a YouTube video link.");
    }
    let source = input.trim();
    if (!/^[A-Za-z][A-Za-z\d+.-]*:/.test(source)) source = "https://" + source;
    let address;
    try {
      address = new URL(source);
    } catch (_) {
      throw new Error("This does not look like a YouTube link.");
    }
    if (!/^https?:$/.test(address.protocol) || address.username || address.password || address.port) {
      throw new Error("Use a plain HTTP or HTTPS YouTube link.");
    }

    const path = address.pathname.split("/").filter(Boolean);
    let videoId;
    if (SHORT_HOSTS.has(address.hostname) && path.length === 1) {
      videoId = path[0];
    } else if (YOUTUBE_HOSTS.has(address.hostname)) {
      if (address.pathname === "/watch") {
        if (address.searchParams.getAll("v").length !== 1) {
          throw new Error("The link must contain exactly one video ID.");
        }
        videoId = address.searchParams.get("v");
      } else if (path.length === 2 && ["shorts", "live", "embed"].includes(path[0])) {
        videoId = path[1];
      }
    } else if (EMBED_HOSTS.has(address.hostname) && path.length === 2 && path[0] === "embed") {
      videoId = path[1];
    }
    if (!VIDEO_ID.test(videoId || "")) {
      throw new Error("The link must point to one YouTube video: watch, youtu.be, shorts or live.");
    }

    let startSeconds = 0;
    let hasTime = false;
    for (const key of ["t", "start", "time_continue"]) {
      const values = address.searchParams.getAll(key);
      if (values.length > 1) throw new Error("The link repeats its start time.");
      if (values.length) {
        const seconds = parseTime(values[0]);
        if (!hasTime) startSeconds = seconds;
        hasTime = true;
      }
    }
    const hash = new URLSearchParams(address.hash.slice(1));
    if (hash.has("t")) {
      if (hash.getAll("t").length > 1) throw new Error("The link repeats its start time.");
      const seconds = parseTime(hash.get("t"));
      if (!hasTime) startSeconds = seconds;
    }
    return canonicalVideo(videoId, startSeconds);
  }

  // Tile layouts per video count, in the spirit of Windows snap layouts and tiling window managers.
  // Areas a-d are filled in the order of the user's videos.
  const LAYOUTS = Object.freeze({
    1: [{ id: "single", label: "Single", areas: '"a"', cols: "1fr", rows: "1fr" }],
    2: [
      { id: "split", label: "Side by side", areas: '"a b"', cols: "1fr 1fr", rows: "1fr" },
      { id: "main-side", label: "Wide and narrow", areas: '"a b"', cols: "2fr 1fr", rows: "1fr" },
      { id: "rows", label: "Top and bottom", areas: '"a" "b"', cols: "1fr", rows: "1fr 1fr" }
    ],
    3: [
      { id: "main-stack", label: "Half and two stacked", areas: '"a b" "a c"', cols: "1fr 1fr", rows: "1fr 1fr" },
      { id: "wide-stack", label: "Wide and two stacked", areas: '"a b" "a c"', cols: "2fr 1fr", rows: "1fr 1fr" },
      { id: "columns", label: "Three columns", areas: '"a b c"', cols: "1fr 1fr 1fr", rows: "1fr" },
      { id: "top-main", label: "Wide top, two below", areas: '"a a" "b c"', cols: "1fr 1fr", rows: "2fr 1fr" }
    ],
    4: [
      { id: "grid", label: "Grid", areas: '"a b" "c d"', cols: "1fr 1fr", rows: "1fr 1fr" },
      { id: "main-stack", label: "Wide and three stacked", areas: '"a b" "a c" "a d"', cols: "2fr 1fr", rows: "1fr 1fr 1fr" },
      { id: "top-main", label: "Wide top, three below", areas: '"a a a" "b c d"', cols: "1fr 1fr 1fr", rows: "2fr 1fr" }
    ]
  });

  function layoutFor(count, id) {
    const options = LAYOUTS[Math.max(1, Math.min(MAX_VIDEOS, count))];
    return options.find(layout => layout.id === id) || options[0];
  }

  function volumeOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : fallback;
  }

  function normalizeSession(input) {
    const session = input && typeof input === "object" ? input : {};
    const videos = [];
    const videoIds = new Set();
    const cardIds = new Set();
    const entries = Array.isArray(session.videos) ? session.videos : [];
    for (const entry of entries) {
      if (videos.length === MAX_VIDEOS) break;
      if (!entry || typeof entry !== "object") continue;
      let video;
      try {
        if (typeof entry.url === "string") {
          video = parseVideoUrl(entry.url);
        } else if (typeof entry.videoId === "string" && VIDEO_ID.test(entry.videoId) && (entry.startSeconds === undefined || validSeconds(entry.startSeconds))) {
          video = canonicalVideo(entry.videoId, entry.startSeconds || 0);
        } else {
          continue;
        }
        if (entry.startSeconds !== undefined) {
          if (!validSeconds(entry.startSeconds)) continue;
          video = canonicalVideo(video.videoId, entry.startSeconds);
        }
      } catch (_) {
        continue;
      }
      if (videoIds.has(video.videoId)) continue;
      let id = typeof entry.id === "string" && CARD_ID.test(entry.id) && !cardIds.has(entry.id) ? entry.id : "mv-" + video.videoId;
      while (cardIds.has(id)) id = "mv-" + id;
      videoIds.add(video.videoId);
      cardIds.add(id);
      videos.push({ id, ...video });
    }
    const layouts = {};
    const savedLayouts = session.layouts && typeof session.layouts === "object" ? session.layouts : {};
    for (const count of [2, 3, 4]) {
      const id = savedLayouts[count];
      if (typeof id === "string" && LAYOUTS[count].some(layout => layout.id === id)) layouts[count] = id;
    }
    return { videos, volume: volumeOr(session.volume, 70), dock: session.dock === "right" ? "right" : "main", layouts };
  }

  /** Coordinates ready IFrame API players. It never starts, pauses or seeks them. */
  class AudioCoordinator {
    constructor(volume = 70) {
      this.selectedId = null;
      this.volume = volumeOr(volume, 70);
      this.players = new Map();
      this._revision = 0;
      this._destroyed = false;
    }

    _call(player, method, argument) {
      try {
        if (!player || typeof player[method] !== "function") return { ok: false };
        return { ok: true, value: argument === undefined ? player[method]() : player[method](argument) };
      } catch (_) {
        return { ok: false };
      }
    }

    _mute(player, force) {
      const state = this._call(player, "isMuted");
      if (!force && state.ok && state.value === true) return true;
      return this._call(player, "mute").ok;
    }

    add(id, player) {
      if (this._destroyed || typeof id !== "string" || !id || !player) return false;
      const previous = this.players.get(id);
      if (previous && previous !== player && !this._mute(previous, true)) return false;
      this.players.set(id, player);
      this._mute(player, true);
      this._call(player, "setVolume", this.volume);
      return this.reconcile();
    }

    remove(id) {
      const player = this.players.get(id);
      if (player) this._mute(player, true);
      this.players.delete(id);
      if (this.selectedId === id) this.selectedId = null;
      this._revision += 1;
      return this.reconcile();
    }

    select(id) {
      if (this._destroyed || (id !== null && (typeof id !== "string" || !id))) return false;
      this.selectedId = id;
      this._revision += 1;
      return this._reconcile(true);
    }

    setVolume(value) {
      if (this._destroyed) return false;
      this.volume = volumeOr(value, this.volume);
      let success = true;
      for (const player of this.players.values()) {
        if (!this._call(player, "setVolume", this.volume).ok) success = false;
      }
      return success;
    }

    _reconcile(forceMute) {
      if (this._destroyed) return false;
      const revision = this._revision;
      const selected = this.selectedId;
      let othersMuted = true;
      for (const [id, player] of this.players) {
        if (id !== selected && !this._mute(player, forceMute)) othersMuted = false;
        if (revision !== this._revision || this._destroyed) return false;
      }
      const target = this.players.get(selected);
      if (!target) return othersMuted;
      if (!othersMuted) {
        this._mute(target, true);
        return false;
      }
      const state = this._call(target, "isMuted");
      if (revision !== this._revision || this._destroyed) return false;
      if (!forceMute && state.ok && state.value === false) return true;
      return this._call(target, "unMute").ok;
    }

    reconcile() {
      return this._reconcile(false);
    }

    destroy() {
      this._destroyed = true;
      this._revision += 1;
      this.selectedId = null;
      for (const player of this.players.values()) this._mute(player, true);
      this.players.clear();
    }
  }

  const api = Object.freeze({ MAX_VIDEOS, LAYOUTS, layoutFor, parseVideoUrl, normalizeSession, AudioCoordinator });
  root.YTMultiViewCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
