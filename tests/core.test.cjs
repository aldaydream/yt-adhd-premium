"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseVideoUrl, normalizeSession, AudioCoordinator, LAYOUTS, layoutFor } = require("../extension/core.js");
const first = "M7lc1UVf-VE";
const second = "aqz-KE-bpKQ";

test("watch, short, shorts, live and embed links canonicalize IDs and time", () => {
  const cases = [
    [`https://www.youtube.com/watch?v=${first}&t=1h2m3s`, 3723],
    [`https://youtu.be/${first}?t=90`, 90],
    [`youtube.com/shorts/${first}?start=5`, 5],
    [`http://m.youtube.com/live/${first}?time_continue=30`, 30],
    [`https://www.youtube.com/embed/${first}?start=0`, 0],
    [`https://www.youtube-nocookie.com/embed/${first}#t=2m`, 120],
    [`https://www.youtube.com/watch?v=${first}&list=example&t=25s`, 25]
  ];
  for (const [url, seconds] of cases) {
    assert.deepEqual(parseVideoUrl(url), {
      videoId: first,
      startSeconds: seconds,
      url: `https://www.youtube.com/watch?v=${first}${seconds ? `&t=${seconds}s` : ""}`
    });
  }
});

test("timestamps use explicit precedence and reject malformed values", () => {
  assert.equal(parseVideoUrl(`https://youtu.be/${first}?t=7&start=9#t=11`).startSeconds, 7);
  for (const stamp of ["-1", "1.5", "NaN", "", "1m2h", "3x", "1:30", "9007199254740992"]) {
    assert.throws(() => parseVideoUrl(`https://youtu.be/${first}?t=${encodeURIComponent(stamp)}`));
  }
  assert.throws(() => parseVideoUrl(`https://youtu.be/${first}?t=1&t=2`));
  assert.throws(() => parseVideoUrl(`https://youtu.be/${first}?t=1&start=-1`));
});

test("foreign hosts, credentials, schemes and non-video paths are rejected", () => {
  for (const url of [
    `https://youtube.com.attacker.example/watch?v=${first}`,
    `https://evil.example/?v=${first}`,
    `https://user:password@youtube.com/watch?v=${first}`,
    `javascript:alert(1)`, `file:///youtube.com/watch?v=${first}`,
    `https://youtube.com:8000/watch?v=${first}`, `https://youtube.com/playlist?list=1`,
    `https://youtu.be/${first}/other`, `https://youtube.com/watch?v=short`,
    `https://youtube.com/watch?v=${first}&v=${second}`, `https://youtube-nocookie.com/watch?v=${first}`,
    null, {}, ""
  ]) assert.throws(() => parseVideoUrl(url));
});

test("stored state is sanitized, deduplicated and bounded to four videos", () => {
  const state = normalizeSession({ volume: 250, videos: [
    null,
    { id: "card-a", url: `https://youtu.be/${first}?t=20` },
    { id: "duplicate", videoId: first, startSeconds: 5 },
    { id: "card-a", videoId: second, startSeconds: 0 },
    { id: "<script>", videoId: "dQw4w9WgXcQ", startSeconds: 1 },
    { id: "broken", videoId: "ZZZZZZZZZZZ", startSeconds: -1 },
    { id: "card-d", videoId: "jNQXAC9IVRw" },
    { id: "card-e", videoId: "AAAAAAAAAAA" }
  ] });
  assert.equal(state.volume, 100);
  assert.equal(state.videos.length, 4);
  assert.equal(state.videos[0].startSeconds, 20);
  assert.equal(state.videos[0].id, "card-a");
  assert.equal(state.videos[1].id, `mv-${second}`);
  assert.equal(state.videos[2].id, "mv-dQw4w9WgXcQ");
  assert.equal(new Set(state.videos.map((video) => video.id)).size, 4);
  assert.deepEqual(normalizeSession(null), { videos: [], volume: 70, dock: "main", layouts: {} });
  assert.equal(normalizeSession({ volume: -30 }).volume, 0);
  assert.equal(normalizeSession({ volume: NaN }).volume, 70);
  assert.equal(normalizeSession({ volume: null }).volume, 70);
});

function mockPlayer(id, calls) {
  return {
    muted: false,
    volume: 100,
    time: 17,
    playing: true,
    mute() { calls.push(`${id}:mute`); this.muted = true; },
    unMute() { calls.push(`${id}:unMute`); this.muted = false; },
    isMuted() { return this.muted; },
    setVolume(volume) { calls.push(`${id}:volume:${volume}`); this.volume = volume; },
    playVideo() { throw new Error("Transport must remain untouched"); },
    pauseVideo() { throw new Error("Transport must remain untouched"); },
    seekTo() { throw new Error("Transport must remain untouched"); }
  };
}

test("synthetic players start muted, switch mute-first and retain transport state", () => {
  const calls = [];
  const a = mockPlayer("a", calls);
  const b = mockPlayer("b", calls);
  const coordinator = new AudioCoordinator(70);
  coordinator.add("a", a);
  coordinator.add("b", b);
  assert.equal(a.muted, true);
  assert.equal(b.muted, true);
  coordinator.select("a");
  calls.length = 0;
  coordinator.select("b");
  assert.deepEqual(calls, ["a:mute", "b:unMute"]);
  assert.equal(coordinator.selectedId, "b");
  assert.equal(a.time, 17);
  assert.equal(b.time, 17);
  assert.equal(a.playing, true);
  assert.equal(b.playing, true);
  coordinator.setVolume(31);
  assert.equal(a.volume, 31);
  assert.equal(b.volume, 31);
  assert.equal(b.muted, false);
});

test("latest rapid choice wins and pending selected player becomes audible on add", () => {
  const calls = [];
  const a = mockPlayer("a", calls);
  const b = mockPlayer("b", calls);
  const coordinator = new AudioCoordinator();
  coordinator.add("a", a);
  coordinator.select("b");
  assert.equal(a.muted, true);
  assert.equal(coordinator.selectedId, "b");
  coordinator.add("b", b);
  assert.equal(b.muted, false);
  coordinator.select("a");
  coordinator.select("b");
  coordinator.select(null);
  coordinator.select("a");
  assert.equal(a.muted, false);
  assert.equal(b.muted, true);
});

test("reconcile corrects native controls and stable reconciliation sends no setters", () => {
  const calls = [];
  const a = mockPlayer("a", calls);
  const b = mockPlayer("b", calls);
  const coordinator = new AudioCoordinator();
  coordinator.add("a", a);
  coordinator.add("b", b);
  coordinator.select("a");
  a.muted = true;
  b.muted = false;
  calls.length = 0;
  coordinator.reconcile();
  assert.deepEqual(calls, ["b:mute", "a:unMute"]);
  calls.length = 0;
  coordinator.reconcile();
  assert.deepEqual(calls, []);
});

test("removing selected video leaves silence and destroy mutes remaining players", () => {
  const calls = [];
  const a = mockPlayer("a", calls);
  const b = mockPlayer("b", calls);
  const coordinator = new AudioCoordinator();
  coordinator.add("a", a);
  coordinator.add("b", b);
  coordinator.select("a");
  coordinator.remove("a");
  assert.equal(coordinator.selectedId, null);
  assert.equal(a.muted, true);
  assert.equal(b.muted, true);
  coordinator.select("b");
  coordinator.destroy();
  assert.equal(b.muted, true);
  assert.equal(coordinator.select("b"), false);
  assert.equal(coordinator.add("a", a), false);
});

test("failed mute leaves target silent, isolated volume failure preserves other players", () => {
  const calls = [];
  const a = mockPlayer("a", calls);
  const b = mockPlayer("b", calls);
  const coordinator = new AudioCoordinator();
  coordinator.add("a", a);
  coordinator.add("b", b);
  a.muted = false;
  a.mute = () => { throw new Error("Synthetic disconnected iframe"); };
  calls.length = 0;
  assert.equal(coordinator.select("b"), false);
  assert.equal(b.muted, true);
  assert.ok(!calls.includes("b:unMute"));
  a.setVolume = () => { throw new Error("Synthetic volume failure"); };
  assert.equal(coordinator.setVolume(42), false);
  assert.equal(b.volume, 42);
});

test("reentrant later selection cannot be overwritten by stale unmute", () => {
  const calls = [];
  const a = mockPlayer("a", calls);
  const b = mockPlayer("b", calls);
  const c = mockPlayer("c", calls);
  const coordinator = new AudioCoordinator();
  coordinator.add("a", a);
  coordinator.add("b", b);
  coordinator.add("c", c);
  const mute = a.mute;
  let triggered = false;
  a.mute = function () {
    mute.call(this);
    if (!triggered) { triggered = true; coordinator.select("c"); }
  };
  coordinator.select("b");
  assert.equal(coordinator.selectedId, "c");
  assert.equal(a.muted, true);
  assert.equal(b.muted, true);
  assert.equal(c.muted, false);
});

test("rapid A to B to A switches restore A despite delayed commands and stale isMuted cache", () => {
  // Synthetic IFrame API: muting commands execute later and cached state updates then.
  const commands = [];
  const player = () => ({
    muted: false,
    mute() { commands.push(() => { this.muted = true; }); },
    unMute() { commands.push(() => { this.muted = false; }); },
    isMuted() { return this.muted; },
    setVolume() {}
  });
  const applyPending = () => { while (commands.length) commands.shift()(); };
  const a = player();
  const b = player();
  const coordinator = new AudioCoordinator();
  coordinator.add("a", a);
  coordinator.add("b", b);
  applyPending();
  coordinator.select("a");
  applyPending();
  assert.equal(a.isMuted(), false);
  coordinator.select("b");
  coordinator.select("a");
  assert.equal(a.isMuted(), false, "Cached state remains stale until messages run");
  applyPending();
  assert.equal(coordinator.selectedId, "a");
  assert.equal(a.isMuted(), false, "Final selection must enqueue an unmute despite stale cache");
  assert.equal(b.isMuted(), true);
});

test("layouts fill every tile once and fall back to the first preset", () => {
  for (const [count, options] of Object.entries(LAYOUTS)) {
    for (const layout of options) {
      const cells = layout.areas.replace(/"/g, " ").trim().split(/\s+/);
      const rows = layout.areas.match(/"[^"]+"/g);
      assert.deepEqual([...new Set(cells)].sort(), "abcd".slice(0, Number(count)).split(""), layout.id);
      assert.equal(rows.length, layout.rows.split(" ").length, layout.id);
      for (const row of rows) assert.equal(row.slice(1, -1).split(" ").length, layout.cols.split(" ").length, layout.id);
    }
  }
  assert.equal(layoutFor(4, "top-main").id, "top-main");
  assert.equal(layoutFor(3, "unknown").id, "main-stack");
  assert.equal(layoutFor(0).id, "single");
  assert.equal(layoutFor(9).id, "grid");
});

test("dock and per-count layouts are restored only when valid", () => {
  const state = normalizeSession({ dock: "right", layouts: { 2: "rows", 3: "nope", 4: "grid", 1: "single", 5: "grid" } });
  assert.equal(state.dock, "right");
  assert.deepEqual(state.layouts, { 2: "rows", 4: "grid" });
  assert.equal(normalizeSession({ dock: "left" }).dock, "main");
  assert.deepEqual(normalizeSession({ layouts: "grid" }).layouts, {});
});

test("the players' own sound controls win once commands have settled", () => {
  let now = 0;
  const calls = [];
  const a = mockPlayer("a", calls);
  const b = mockPlayer("b", calls);
  const audio = new AudioCoordinator(70, () => now);
  audio.add("a", a);
  audio.add("b", b);
  audio.select("a");
  b.muted = false;
  audio.reconcile();
  assert.equal(audio.selectedId, "a", "a stale report right after our command is corrected");
  assert.equal(b.muted, true);
  now = 2000;
  b.muted = false;
  audio.reconcile();
  assert.equal(audio.selectedId, "b", "a manual unmute picks that player");
  assert.deepEqual([a.muted, b.muted], [true, false]);
  now = 4000;
  b.muted = true;
  audio.reconcile();
  assert.equal(audio.selectedId, null, "a manual mute of the source means silence");
  assert.deepEqual([a.muted, b.muted], [true, true]);
});
