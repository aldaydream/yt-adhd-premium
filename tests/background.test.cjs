"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");
const clientId = "abcdefghijklmnopabcdefghijklmnop";
const videoId = "M7lc1UVf-VE";
const watchTab = { id: 37, url: `https://www.youtube.com/watch?v=${videoId}` };
const flush = () => new Promise(setImmediate);
const plain = (value) => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  const calls = [];
  const errors = [];
  const rules = new Map();
  const listeners = {};
  const state = { rootPresent: false, ...options };
  const event = (name) => ({ addListener(handler) { listeners[name] = handler; } });
  const context = {
    URL,
    console: { error(...args) { errors.push(args); } },
    chrome: {
      runtime: { id: clientId, onMessage: event("message") },
      declarativeNetRequest: {
        async getSessionRules() { return [...rules.values()]; },
        async updateSessionRules(change) {
          calls.push({ type: "rules", change: plain(change) });
          if (state.onUpdate) await state.onUpdate(change);
          for (const id of change.removeRuleIds || []) rules.delete(id);
          for (const rule of change.addRules || []) rules.set(rule.id, plain(rule));
        }
      },
      action: {
        onClicked: event("clicked"),
        async setBadgeText(value) { calls.push({ type: "badge", value: plain(value) }); },
        async setBadgeBackgroundColor(value) { calls.push({ type: "color", value: plain(value) }); },
        async setTitle(value) { calls.push({ type: "title", value: plain(value) }); }
      },
      scripting: {
        async executeScript(script) {
          calls.push({ type: "inject", script });
          if (state.injectionError) throw state.injectionError;
          if (state.onExecute) await state.onExecute(script);
          return [{ result: Boolean(state.rootPresent) }];
        }
      },
      tabs: {
        onRemoved: event("removed"),
        onUpdated: event("updated"),
        async sendMessage(tabId, message) {
          calls.push({ type: "send", tabId, message: plain(message) });
          if (state.replyError) throw state.replyError;
          if (state.onSend) await state.onSend(tabId, message);
          return state.reply === undefined ? { ok: true } : state.reply;
        }
      }
    }
  };
  vm.runInNewContext(source, context, { filename: "background.js" });
  return { api: context.__YT_MULTI_VIEW_BACKGROUND__, listeners, calls, rules, state, errors };
}

// This is a synthetic evaluator of the fields emitted by ruleForTab, not browser DNR.
function matchesRule(rule, request) {
  return rule.condition.tabIds.includes(request.tabId)
    && rule.condition.resourceTypes.includes(request.resourceType)
    && new RegExp(rule.condition.regexFilter).test(request.url);
}

test("synthetic DNR scoping modifies only this tab's marked embed subframes", () => {
  const { api } = harness();
  const rule = plain(api.ruleForTab(watchTab.id));
  assert.equal(rule.id, watchTab.id);
  assert.equal(rule.action.type, "modifyHeaders");
  assert.deepEqual(rule.action.requestHeaders, [{
    header: "Referer", operation: "set", value: `https://adhd-multiview.${clientId}/`
  }]);
  const request = {
    tabId: watchTab.id,
    resourceType: "sub_frame",
    url: `https://www.youtube-nocookie.com/embed/${videoId}?mv_client=${clientId}&enablejsapi=1&origin=https%3A%2F%2Fwww.youtube.com`
  };
  assert.equal(matchesRule(rule, request), true);
  const rejected = [
    { tabId: 38 },
    { resourceType: "main_frame" },
    { resourceType: "xmlhttprequest" },
    { resourceType: "media" },
    { url: request.url.replace("www.youtube-nocookie.com", "www.youtube.com") },
    { url: request.url.replace("www.youtube-nocookie.com", "www.youtube-nocookie.com.attacker.example") },
    { url: request.url.replace("www.youtube-nocookie.com", "r1---example.googlevideo.com") },
    { url: request.url.replace(`mv_client=${clientId}`, `mv_client=pppppppppppppppppppppppppppppppp`) },
    { url: request.url.replace(`mv_client=${clientId}&`, "") },
    { url: request.url.replace(`?mv_client=${clientId}&`, `?other=1&mv_client=${clientId}&`) },
    { url: request.url.replace(videoId, "short") },
    { url: request.url.replace("https:", "http:") }
  ];
  for (const patch of rejected) {
    assert.equal(matchesRule(rule, { ...request, ...patch }), false, JSON.stringify(patch));
  }
});

test("identity rule is installed before MAIN and ISOLATED injection and toggle delivery", async () => {
  const { api, calls, rules } = harness();
  await api.toggle(watchTab);
  assert.deepEqual(calls.slice(0, 5).map((call) => call.type), ["rules", "inject", "inject", "inject", "send"]);
  const injections = calls.filter((call) => call.type === "inject").map((call) => call.script);
  assert.deepEqual(plain(injections[0].args), [clientId]);
  assert.equal(injections[0].world, "MAIN");
  assert.equal(injections[1].world, "MAIN");
  assert.deepEqual(plain(injections[1].files), ["core.js", "page-bridge.js"]);
  assert.equal(injections[2].world, "ISOLATED");
  assert.deepEqual(plain(injections[2].files), ["core.js", "content.js"]);
  assert.equal(rules.has(watchTab.id), true);
  assert.deepEqual(calls.find((call) => call.type === "send").message, { type: "MV_TOGGLE" });
});

test("non-YouTube URLs, embeds and invalid tabs receive no injection or identity rule", async () => {
  const supported = [watchTab.url, `https://www.youtube.com/shorts/${videoId}`, `https://www.youtube.com/live/${videoId}/`,
    "https://www.youtube.com/", "https://www.youtube.com/results?search_query=video", "https://www.youtube.com/feed/subscriptions"];
  const unsupported = [
    "edge://extensions/",
    `http://www.youtube.com/watch?v=${videoId}`, `https://m.youtube.com/watch?v=${videoId}`,
    `https://youtube.com/watch?v=${videoId}`, `https://www.youtube.com.attacker.example/watch?v=${videoId}`,
    `https://www.youtube.com/embed/${videoId}`, "invalid"
  ];
  const { api, calls } = harness();
  for (const url of supported) assert.equal(api.isYouTubePage(url), true);
  for (const url of unsupported) {
    assert.equal(api.isYouTubePage(url), false);
    await api.toggle({ id: watchTab.id, url });
  }
  for (const id of [undefined, null, -1, 0, 1.5, "37"]) await api.toggle({ id, url: watchTab.url });
  assert.equal(calls.some((call) => ["inject", "rules", "send"].includes(call.type)), false);
});

test("activation failure removes installed rules and exposes a toolbar error", async () => {
  for (const failure of [{ injectionError: new Error("Synthetic CSP denial") }, { reply: { ok: false } }, { replyError: new Error("Synthetic unavailable tab") }]) {
    const { api, calls, rules, errors } = harness(failure);
    await api.toggle(watchTab);
    assert.equal(rules.has(watchTab.id), false);
    const changes = calls.filter((call) => call.type === "rules");
    assert.equal(changes.length, 2);
    assert.deepEqual(changes[1].change, { removeRuleIds: [watchTab.id] });
    assert.equal(calls.some((call) => call.type === "badge" && call.value.text === "!"), true);
    assert.equal(errors.length, 1);
  }
});

test("rapid toolbar activations are serialized within one tab", async () => {
  let unblock;
  const gate = new Promise((resolve) => { unblock = resolve; });
  let updates = 0;
  const { api, calls } = harness({ async onUpdate() { if (++updates === 1) await gate; } });
  const first = api.toggle(watchTab);
  const second = api.toggle(watchTab);
  await flush();
  assert.deepEqual(calls.map((call) => call.type), ["rules"]);
  unblock();
  await Promise.all([first, second]);
  const activations = calls.filter((call) => ["rules", "inject", "send"].includes(call.type));
  assert.deepEqual(activations.map((call) => call.type), [
    "rules", "inject", "inject", "inject", "send", "rules", "inject", "inject", "inject", "send"
  ]);
});

test("tab removal and navigation release rules while unrelated updates preserve them", async () => {
  const { api, listeners, rules } = harness();
  await api.toggle(watchTab);
  listeners.updated(watchTab.id, { title: "Changed title" });
  await flush();
  assert.equal(rules.has(watchTab.id), true);
  listeners.updated(watchTab.id, { status: "loading" });
  await flush();
  assert.equal(rules.has(watchTab.id), false);
  await api.toggle(watchTab);
  listeners.updated(watchTab.id, { url: "https://www.youtube.com/" });
  await flush();
  assert.equal(rules.has(watchTab.id), false);
  await api.toggle(watchTab);
  listeners.removed(watchTab.id);
  await flush();
  assert.equal(rules.has(watchTab.id), false);
});

async function release(h, sender) {
  let response;
  const keepAlive = h.listeners.message({ type: "MV_RELEASE" }, sender, (value) => { response = value; });
  await flush();
  return { keepAlive, response: response && plain(response) };
}

test("exit removes rule, and a late exit preserves a newly opened root's rule", async () => {
  const h = harness();
  const sender = { id: clientId, frameId: 0, tab: watchTab };
  await h.api.toggle(watchTab);
  const closed = await release(h, sender);
  assert.equal(closed.keepAlive, true);
  assert.deepEqual(closed.response, { ok: true });
  assert.equal(h.rules.has(watchTab.id), false);
  await h.api.toggle(watchTab);
  h.state.rootPresent = true;
  const late = await release(h, sender);
  assert.deepEqual(late.response, { ok: true });
  assert.equal(h.rules.has(watchTab.id), true);
  const checks = h.calls.filter((call) => call.type === "inject" && call.script.func && !call.script.args);
  assert.equal(checks.length, 2);
  assert.deepEqual(plain(checks[0].script.target), { tabId: watchTab.id });
});

test("release boundary ignores another extension, unknown frames and missing tabs", async () => {
  const h = harness();
  await h.api.toggle(watchTab);
  const baseline = h.calls.length;
  const invalid = [
    { id: "pppppppppppppppppppppppppppppppp", frameId: 0, tab: watchTab },
    { id: clientId, frameId: 1, tab: watchTab },
    { id: clientId, tab: watchTab },
    { id: clientId, frameId: 0 },
    { id: clientId, frameId: 0, tab: {} }
  ];
  for (const sender of invalid) {
    assert.deepEqual(await release(h, sender), { keepAlive: false, response: undefined });
  }
  const unknown = h.listeners.message({ type: "UNRELATED" }, { id: clientId, frameId: 0, tab: watchTab }, () => assert.fail("Unexpected response"));
  assert.equal(unknown, false);
  assert.equal(h.calls.length, baseline);
  assert.equal(h.rules.has(watchTab.id), true);
});

function delayedActivation() {
  let unblock;
  const gate = new Promise((resolve) => { unblock = resolve; });
  const h = harness({
    async onExecute(script) { if (script.args) await gate; },
    async onSend() { h.state.rootPresent = true; }
  });
  return { h, unblock };
}

test("release arriving during activation waits for its root before deciding cleanup", async () => {
  const { h, unblock } = delayedActivation();
  const activation = h.api.toggle(watchTab);
  await flush();
  assert.equal(h.rules.has(watchTab.id), true);
  let response;
  const keepAlive = h.listeners.message(
    { type: "MV_RELEASE" },
    { id: clientId, frameId: 0, tab: watchTab },
    (value) => { response = plain(value); }
  );
  await flush();
  assert.equal(keepAlive, true);
  assert.equal(response, undefined);
  assert.equal(h.calls.filter((call) => call.type === "inject").length, 1);
  unblock();
  await activation;
  await flush();
  assert.deepEqual(response, { ok: true });
  assert.equal(h.rules.has(watchTab.id), true);
  const checkIndex = h.calls.findIndex((call) => call.type === "inject" && call.script.func && !call.script.args);
  const sendIndex = h.calls.findIndex((call) => call.type === "send");
  assert.ok(checkIndex > sendIndex);
});

test("queued navigation keeps a surviving root and later clears a closed root", async () => {
  const { h, unblock } = delayedActivation();
  const activation = h.api.toggle(watchTab);
  await flush();
  h.listeners.updated(watchTab.id, { status: "loading" });
  await flush();
  assert.equal(h.calls.filter((call) => call.type === "inject").length, 1);
  assert.equal(h.rules.has(watchTab.id), true);
  unblock();
  await activation;
  await flush();
  assert.equal(h.rules.has(watchTab.id), true);
  h.state.rootPresent = false;
  h.listeners.updated(watchTab.id, { url: "https://www.youtube.com/" });
  await flush();
  assert.equal(h.rules.has(watchTab.id), false);
});

test("tab removal queued during activation performs final rule cleanup", async () => {
  const { h, unblock } = delayedActivation();
  const activation = h.api.toggle(watchTab);
  await flush();
  h.listeners.removed(watchTab.id);
  await flush();
  assert.equal(h.rules.has(watchTab.id), true);
  unblock();
  await activation;
  await flush();
  assert.equal(h.rules.has(watchTab.id), false);
  const changes = h.calls.filter((call) => call.type === "rules");
  assert.deepEqual(changes.at(-1).change, { removeRuleIds: [watchTab.id] });
});

test("navigation in a tab without a MultiView rule injects nothing", async () => {
  const { listeners, calls } = harness();
  listeners.updated(99, { status: "loading" });
  listeners.updated(99, { url: "https://www.youtube.com/" });
  await flush();
  assert.equal(calls.filter((call) => call.type === "inject").length, 0);
});
