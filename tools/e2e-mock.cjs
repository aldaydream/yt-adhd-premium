/*
 * Offline end-to-end test. Loads the real extension into Chromium and runs it against a local mock of
 * YouTube watch pages, the IFrame Player API and embed pages. No network access to YouTube is needed.
 *
 * Requirements: Linux or macOS, openssl, Playwright with Chromium (PLAYWRIGHT_PATH or `npm i -D playwright`).
 * Binds port 443 on 127.0.0.1 (run as root or inside a container). Usage: node tools/e2e-mock.cjs
 * Screenshots go to E2E_OUT (default: <tmp>/mv-e2e).
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const EXTENSION = path.resolve(__dirname, '../extension');
const OUT = process.env.E2E_OUT || path.join(os.tmpdir(), 'mv-e2e');
const IDS = ['M7lc1UVf-VE', 'aqz-KE-bpKQ', 'YE7VzlLtp-4', 'eRsGyueVLvQ', 'jNQXAC9IVRw'];
const embeds = [];
const results = [];
const pass = (name, data = '') => { results.push(name); console.log('PASS', name, data && JSON.stringify(data)); };

function extensionId() {
  const key = JSON.parse(fs.readFileSync(path.join(EXTENSION, 'manifest.json'), 'utf8')).key;
  const hash = require('node:crypto').createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex');
  return hash.slice(0, 32).replace(/[0-9a-f]/g, c => 'abcdefghijklmnop'[parseInt(c, 16)]);
}

const page = (body, script = '') => `<!doctype html><html dark><head><meta charset="utf-8"><style>
  body{margin:0;background:#0f0f0f;color:#eee;font:14px Arial,sans-serif}
  #masthead-container{position:fixed;top:0;left:0;right:0;height:56px;background:#212121;z-index:2020;display:flex;align-items:center;padding:0 16px}
  ytd-app{display:block;padding-top:56px}
  #columns{display:flex}
  #primary{flex:1 1 0;min-width:0;padding:12px 16px 0}
  #secondary{width:402px;flex:none;padding:12px 24px 0 0}
  #movie_player{aspect-ratio:16/9;background:#5a1a1a;display:grid;place-items:center}
  #below{height:1600px;padding:12px;background:#1b1b1b}
  .item{display:flex;gap:8px;margin:0 0 8px;color:#eee;text-decoration:none}
  .thumb{width:168px;height:94px;background:#2d3b55;border-radius:8px;flex:none}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:24px}
  .grid .thumb{width:100%;height:auto;aspect-ratio:16/9}
  ytd-miniplayer{position:fixed;right:12px;bottom:12px;width:400px;height:225px;background:#665500;z-index:2030}
</style></head><body><div id="masthead-container">Mock YouTube</div>${body}<script>${script}</script></body></html>`;

// The last feed item carries a button inside its link, like YouTube's "Watch later" on thumbnails.
const feed = id => IDS.filter(other => other !== id).map(other =>
  `<a class="item" href="/watch?v=${other}"><div class="thumb">${other === IDS[4] ? '<button class="later" onclick="event.preventDefault();window.__later=(window.__later||0)+1">Later</button>' : ''}</div><span>Feed video ${other}</span></a>`).join('');

const watchPage = id => page(`<ytd-app><ytd-watch-flexy is-two-columns_><div id="columns">
  <div id="primary"><div id="primary-inner"><div id="player"><div id="movie_player">PAGE PLAYER ${id}<video></video></div></div>
  <div id="below">COMMENTS<p><a id="chapter" href="/watch?v=${id}&t=30s">0:30 chapter of this video</a></p></div></div></div>
  <div id="secondary"><div id="secondary-inner">${feed(id)}<a class="item" id="channel" href="/@channel">A channel page</a></div></div>
  </div></ytd-watch-flexy></ytd-app><ytd-miniplayer>miniplayer</ytd-miniplayer>`,
`const player=document.getElementById('movie_player');let muted=false,state=1;window.__pagePaused=0;
Object.assign(player,{getVideoData:()=>({video_id:${JSON.stringify(id)},title:'Page video',author:'Page channel'}),getCurrentTime:()=>42.7,
getPlayerState:()=>state,pauseVideo(){state=2;window.__pagePaused+=1},mute(){muted=true},unMute(){muted=false},isMuted:()=>muted});`);

const homePage = () => page(`<ytd-app><div class="grid">${IDS.map(id =>
  `<a class="item" style="display:block" href="/watch?v=${id}"><div class="thumb"></div><span>Home video ${id}</span></a>`).join('')}</div></ytd-app>`);

// A stand-in for https://www.youtube.com/iframe_api with the methods the extension uses.
const MOCK_API = `window.__mockPlayers={};window.__created=0;
window.YT={Player:class{constructor(frame,options){const url=new URL(frame.src);this.frame=frame;this.events=options.events;
this.videoId=url.pathname.split('/').pop();this.url=url;this.muted=false;this.volume=100;this.state=-1;window.__created+=1;
window.__mockPlayers[frame.dataset.mvId]=this;setTimeout(()=>{this.events.onReady({target:this});
if(this.videoId==='failedVideo'){this.events.onError({target:this,data:150});return;}
if(url.searchParams.get('autoplay')==='1')this.setState(1);},150);}
setState(s){this.state=s;this.events.onStateChange&&this.events.onStateChange({target:this,data:s});}
mute(){this.muted=true}unMute(){this.muted=false}isMuted(){return this.muted}setVolume(v){this.volume=v}
getVideoData(){return{video_id:this.videoId,title:'Title '+this.videoId,author:'Channel '+this.videoId}}destroy(){this.destroyed=true}}};`;

function serve() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], {stdio: 'ignore'});
  const server = https.createServer({key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem'))}, (request, response) => {
    const url = new URL(request.url, `https://${request.headers.host}`);
    const send = (type, body, status = 200) => { response.writeHead(status, {'content-type': type}); response.end(body); };
    if (url.hostname === 'www.youtube-nocookie.com' && url.pathname.startsWith('/embed/')) {
      embeds.push({url: url.href, referer: request.headers.referer || null});
      return send('text/html', `<body style="margin:0;height:100vh;display:grid;place-items:center;background:#1c2b44;color:#fff;font:600 18px Arial">embed ${url.pathname.slice(7)}</body>`);
    }
    if (url.pathname === '/iframe_api') return send('text/javascript', MOCK_API);
    if (url.pathname === '/watch') return send('text/html', watchPage(url.searchParams.get('v')));
    if (url.pathname === '/') return send('text/html', homePage());
    if (url.pathname === '/@channel') return send('text/html', page('<ytd-app><h1>Channel</h1></ytd-app>'));
    send('text/plain', 'not found', 404);
  });
  return new Promise(resolve => server.listen(443, '127.0.0.1', () => resolve(server)));
}

(async () => {
  fs.mkdirSync(OUT, {recursive: true});
  const server = await serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: {width: 1366, height: 768},
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--ignore-certificate-errors', '--no-proxy-server',
      '--host-resolver-rules=MAP www.youtube.com 127.0.0.1, MAP www.youtube-nocookie.com 127.0.0.1']
  });
  const errors = [];
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 15000});
    const id = new URL(worker.url()).host;
    assert.equal(id, extensionId());
    pass('manifest key gives a stable extension id', id);

    const tab = await context.newPage();
    tab.on('pageerror', error => errors.push(String(error)));
    const toggle = () => worker.evaluate(async () => {
      const [current] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
      await globalThis.__YT_MULTI_VIEW_BACKGROUND__.toggle(current);
      return chrome.action.getBadgeText({tabId: current.id});
    });
    const inPanel = fn => tab.evaluate(fn);
    const cards = () => tab.locator('#yt-multiview-root .card');
    const waitReady = count => tab.waitForFunction(count => {
      const root = document.getElementById('yt-multiview-root')?.shadowRoot;
      return root && root.querySelectorAll('.card').length === count && [...root.querySelectorAll('.card .audio')].every(b => !b.disabled);
    }, count, {timeout: 10000});
    const selected = () => inPanel(() => [...document.getElementById('yt-multiview-root').shadowRoot.querySelectorAll('.card')]
      .map(card => card.dataset.selected === 'true'));
    const audible = () => inPanel(() => Object.values(window.__mockPlayers).filter(p => !p.destroyed && !p.muted).map(p => p.videoId));

    // 1. Open on a watch page: main dock over the player column, feed column untouched.
    await tab.goto(`https://www.youtube.com/watch?v=${IDS[0]}`);
    assert.equal(await toggle(), '');
    await waitReady(1);
    const layout = await inPanel(() => {
      const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return {left: Math.round(r.left), width: Math.round(r.width), top: Math.round(r.top)}; };
      return {root: box('#yt-multiview-root'), primary: box('#primary-inner'), place: document.documentElement.dataset.mvPlace,
        below: getComputedStyle(document.getElementById('below')).display, player: getComputedStyle(document.getElementById('player')).visibility,
        feed: getComputedStyle(document.getElementById('secondary-inner')).visibility, mini: getComputedStyle(document.querySelector('ytd-miniplayer')).display,
        paused: window.__pagePaused};
    });
    assert.equal(layout.place, 'main');
    assert.deepEqual([layout.root.left, layout.root.width], [layout.primary.left, layout.primary.width]);
    assert.equal(layout.root.top, 68);
    assert.deepEqual([layout.below, layout.player, layout.feed, layout.mini], ['none', 'hidden', 'visible', 'none']);
    assert.ok(layout.paused > 0);
    pass('main dock covers the player column, hides player, comments and miniplayer, keeps the feed', layout.root);
    assert.equal(embeds.length, 1);
    assert.equal(embeds[0].referer, `https://adhd-multiview.${id}/`);
    const first = new URL(embeds[0].url);
    assert.deepEqual([first.searchParams.get('mv_client'), first.searchParams.get('start'), first.searchParams.get('autoplay'), first.searchParams.has('mute')], [id, '42', '1', false]);
    pass('page video continues at 42 s with autoplay; embed sends only the extension identity', embeds[0]);
    assert.deepEqual(await audible(), [IDS[0]]);
    assert.deepEqual(await selected(), [true]);
    pass('first video gets the audio');
    await tab.screenshot({path: path.join(OUT, '01-main-one.png')});

    // 2. A click in the feed adds the video, keeps the page, asks which audio to keep.
    const url = tab.url();
    await tab.click(`#secondary a[href="/watch?v=${IDS[1]}"]`);
    await waitReady(2);
    assert.equal(tab.url(), url);
    assert.equal(await tab.locator('#yt-multiview-root .chooser').isVisible(), true);
    assert.equal(new URL(embeds[1].url).searchParams.get('autoplay'), '0', 'second player must wait while the first plays');
    await tab.screenshot({path: path.join(OUT, '02-chooser.png')});
    await tab.locator('#yt-multiview-root .chooser button', {hasText: 'Switch to'}).click();
    await tab.waitForFunction(() => window.__mockPlayers && Object.values(window.__mockPlayers).filter(p => !p.muted).length === 1);
    assert.deepEqual(await audible(), [IDS[1]]);
    assert.equal(await tab.locator('#yt-multiview-root .chooser').isVisible(), false);
    pass('feed click adds a window without navigation; chooser switches the audio; second video waits for Play');

    // 3. A link to a video already in the panel is not added twice and does not navigate.
    await tab.click(`#secondary a[href="/watch?v=${IDS[1]}"] span`);
    assert.equal(tab.url(), url);
    assert.equal(await cards().count(), 2);
    assert.match(await tab.locator('#yt-multiview-root .notice').textContent(), /already in the panel/);
    // A button inside a video link keeps its own action.
    await tab.click('#secondary .later');
    assert.equal(await inPanel(() => window.__later), 1);
    assert.equal(await cards().count(), 2);
    assert.equal(tab.url(), url);
    pass('duplicate link shows a notice; buttons inside video links keep working');

    // 4. Fill four windows, choose layouts, reject a fifth video.
    for (const other of IDS.slice(2, 4)) {
      await tab.click(`#secondary a[href="/watch?v=${other}"] span`);
      await tab.locator('#yt-multiview-root .chooser button', {hasText: 'Keep'}).click();
    }
    await waitReady(4);
    assert.deepEqual(await audible(), [IDS[1]]);
    assert.equal(await tab.locator('#yt-multiview-root .layout').count(), 3);
    await tab.screenshot({path: path.join(OUT, '03-main-grid.png')});
    await tab.locator('#yt-multiview-root .layout[aria-label="Layout: Wide top, three below"]').click();
    const areas = await inPanel(() => document.getElementById('yt-multiview-root').shadowRoot.querySelector('.grid').style.gridTemplateAreas);
    assert.equal(areas, '"a a a" "b c d"');
    await tab.screenshot({path: path.join(OUT, '04-main-top-wide.png')});
    await tab.click(`#secondary a[href="/watch?v=${IDS[4]}"] span`);
    assert.equal(await cards().count(), 4);
    assert.match(await tab.locator('#yt-multiview-root .notice').textContent(), /All four windows/);
    pass('four windows, layout presets, fifth video rejected', {areas});
    const sizes = await inPanel(() => [...document.getElementById('yt-multiview-root').shadowRoot.querySelectorAll('iframe')].map(f => {
      const r = f.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    assert.ok(sizes.every(([w, h]) => w >= 200 && h >= 200), JSON.stringify(sizes));
    pass('every player viewport is at least 200x200', sizes);

    // 5. Swapping windows changes CSS grid areas only: no player is recreated.
    const created = await inPanel(() => window.__created);
    const order = () => inPanel(() => [...document.getElementById('yt-multiview-root').shadowRoot.querySelectorAll('.card')]
      .sort((a, b) => a.style.gridArea.localeCompare(b.style.gridArea)).map(c => c.querySelector('iframe').dataset.mvId));
    const before = await order();
    await tab.locator('#yt-multiview-root .card .grip').first().click();
    const after = await order();
    assert.deepEqual(after, [before[1], before[0], before[2], before[3]]);
    // A gradual drag like a real hand: the first moves stay over the strip, outside the player frames.
    const grip = await tab.locator('#yt-multiview-root .card').nth(3).locator('.grip').boundingBox();
    const target = await tab.locator('#yt-multiview-root .card').nth(1).locator('.player').boundingBox();
    await tab.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await tab.mouse.down();
    await tab.mouse.move(grip.x + grip.width / 2 + 30, grip.y + grip.height / 2 - 4, {steps: 5});
    await tab.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {steps: 10});
    await tab.mouse.up();
    const dragged = await order();
    assert.notDeepEqual(dragged, after);
    assert.equal(await inPanel(() => window.__created), created);
    pass('click and drag swap windows without reloading players', {before, after, dragged});

    // 6. The bottom panel opens inside one window and shrinks only that video.
    // The wide window has room to give; a small one keeps its 200 px player and the panel scrolls instead.
    const card = tab.locator('#yt-multiview-root .card[style*="grid-area: a"]');
    const height = async () => (await card.locator('.player').boundingBox()).height;
    const closed = await height();
    await card.locator('.more').click();
    assert.equal(await card.locator('.details').isVisible(), true);
    assert.match(await card.locator('.details .channel').textContent(), /^Channel /);
    const opened = await height();
    assert.ok(opened < closed, `${opened} < ${closed}`);
    await tab.screenshot({path: path.join(OUT, '05-details-open.png')});
    await card.locator('.more').click();
    pass('details panel shows title and channel and shrinks its video', {closed, opened});

    // 7. Right dock: panel in the recommendations column, page player becomes an audio source.
    await tab.locator('#yt-multiview-root .seg button', {hasText: 'Right'}).click();
    await tab.waitForFunction(() => document.documentElement.dataset.mvPlace === 'right');
    const right = await inPanel(() => {
      const r = document.getElementById('yt-multiview-root').getBoundingClientRect();
      const s = document.getElementById('secondary-inner').getBoundingClientRect();
      return {root: [Math.round(r.left), Math.round(r.width)], secondary: [Math.round(s.left), Math.round(s.width)],
        below: getComputedStyle(document.getElementById('below')).display, player: getComputedStyle(document.getElementById('player')).visibility,
        pageMuted: document.getElementById('movie_player').isMuted()};
    });
    assert.deepEqual(right.root, right.secondary);
    assert.deepEqual([right.below, right.player, right.pageMuted], ['block', 'visible', true]);
    await tab.locator('#yt-multiview-root .only-right').click();
    await tab.waitForFunction(() => !document.getElementById('movie_player').isMuted());
    assert.deepEqual(await audible(), []);
    await tab.screenshot({path: path.join(OUT, '06-right.png')});
    pass('right dock keeps the YouTube player and comments, main video audio works', right);
    // Theater mode puts a full-width player above the columns: the panel starts below it and follows on scroll.
    const theater = async () => inPanel(() => [Math.round(document.getElementById('yt-multiview-root').getBoundingClientRect().top),
      Math.round(document.getElementById('secondary-inner').getBoundingClientRect().top)]);
    await tab.evaluate(() => { document.getElementById('columns').style.marginTop = '300px'; });
    await tab.waitForTimeout(400);
    const [panelTop, columnTop] = await theater();
    assert.equal(panelTop, columnTop);
    await tab.mouse.wheel(0, 200);
    await tab.waitForTimeout(200);
    const [scrolledTop, scrolledColumn] = await theater();
    assert.equal(scrolledTop, Math.max(68, scrolledColumn));
    await tab.evaluate(() => { window.scrollTo(0, 0); document.getElementById('columns').style.marginTop = ''; });
    pass('right dock starts below a theater-mode player and follows the scroll', {panelTop, scrolledTop});

    // 8. A player's own unmute button makes it the source; volume and mute all.
    await tab.waitForTimeout(1600);
    await tab.evaluate(id => { Object.values(window.__mockPlayers).find(p => !p.destroyed && p.videoId === id).muted = false; }, IDS[2]);
    await tab.waitForFunction(() => document.getElementById('movie_player').isMuted(), null, {timeout: 4000});
    assert.deepEqual(await audible(), [IDS[2]]);
    assert.equal(await tab.locator('#yt-multiview-root .card[data-selected=true] .title').textContent(), `Title ${IDS[2]}`);
    pass('unmuting inside a player makes it the sound source');
    await tab.locator('#yt-multiview-root input[type=range]').fill('35');
    assert.ok(await inPanel(() => Object.values(window.__mockPlayers).filter(p => !p.destroyed).every(p => p.volume === 35)));
    await tab.locator('#yt-multiview-root button[aria-label="Mute all"]').click();
    await tab.waitForFunction(() => Object.values(window.__mockPlayers).every(p => p.destroyed || p.muted));
    assert.deepEqual(await audible(), []);
    pass('volume reaches every player; mute all silences tiles and the page player');

    // 8b. Back to Main: the page video moves into the panel again, from the page player's time.
    await tab.locator(`#yt-multiview-root .card:has(.title:text-is("Title ${IDS[0]}")) .remove`).click();
    assert.equal(await cards().count(), 3);
    const beforeMain = embeds.length;
    await tab.locator('#yt-multiview-root .seg button', {hasText: 'Main'}).click();
    await waitReady(4);
    assert.equal(await inPanel(() => document.documentElement.dataset.mvPlace), 'main');
    const resumed = new URL(embeds[beforeMain].url);
    assert.deepEqual([resumed.pathname, resumed.searchParams.get('start')], [`/embed/${IDS[0]}`, '42']);
    pass('switching Right to Main brings the page video back at its time');
    const saved = await order();

    // 9. Close restores the page and releases the network rule.
    await tab.locator('#yt-multiview-root button[aria-label="Close MultiView"]').click();
    await tab.waitForFunction(() => !document.getElementById('yt-multiview-root'));
    const restored = await inPanel(() => ({place: document.documentElement.dataset.mvPlace || null, below: getComputedStyle(document.getElementById('below')).display,
      destroyed: Object.values(window.__mockPlayers).every(p => p.destroyed)}));
    assert.deepEqual(restored, {place: null, below: 'block', destroyed: true});
    await tab.waitForTimeout(300);
    assert.deepEqual(await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []);
    pass('close restores the page, destroys players and removes the rule');

    // 10. Reopen restores the set, its order, layout and dock; nothing autoplays.
    const embedCount = embeds.length;
    await toggle();
    await waitReady(4);
    assert.equal(await inPanel(() => document.documentElement.dataset.mvPlace), 'main');
    assert.ok(embeds.slice(embedCount).every(e => new URL(e.url).searchParams.get('autoplay') === '0'));
    assert.deepEqual(await order(), saved);
    pass('reopen restores order and dock without autoplay');
    await tab.setViewportSize({width: 1920, height: 1080});
    await tab.waitForTimeout(500);
    await tab.screenshot({path: path.join(OUT, '07-main-1920.png')});
    // Single-column watch page: the panel floats and the page player it would cover stays hidden.
    await tab.evaluate(() => document.querySelector('ytd-watch-flexy').removeAttribute('is-two-columns_'));
    await tab.waitForFunction(() => document.documentElement.dataset.mvPlace === 'float');
    assert.equal(await inPanel(() => getComputedStyle(document.getElementById('player')).visibility), 'hidden');
    await tab.evaluate(() => document.querySelector('ytd-watch-flexy').setAttribute('is-two-columns_', ''));
    await tab.waitForFunction(() => document.documentElement.dataset.mvPlace === 'main');
    pass('single-column layout floats the panel and keeps the paused page player hidden');
    await toggle();

    // 11. Any other YouTube page: a floating panel; navigation away from YouTube links still works.
    await tab.setViewportSize({width: 1366, height: 768});
    await tab.goto('https://www.youtube.com/');
    await toggle();
    await waitReady(4);
    assert.equal(await inPanel(() => document.documentElement.dataset.mvPlace), 'float');
    await tab.screenshot({path: path.join(OUT, '08-float-home.png')});
    pass('home page shows the floating panel');

    // 11b. Two quick clicks: only one new window may start by itself.
    for (const id of [IDS[2], IDS[3]]) await tab.locator(`#yt-multiview-root .card:has(.title:text-is("Title ${id}")) .remove`).click();
    const beforeRace = embeds.length;
    await tab.click(`a[href="/watch?v=${IDS[2]}"] span`);
    await tab.click(`a[href="/watch?v=${IDS[4]}"] span`);
    await waitReady(4);
    const flags = embeds.slice(beforeRace).map(e => new URL(e.url).searchParams.get('autoplay'));
    assert.deepEqual(flags.sort(), ['0', '1']);
    pass('rapid clicks start only one window by itself', flags);

    // 11c. A window that fails never takes the audio.
    await tab.locator('#yt-multiview-root .chooser button', {hasText: 'Keep'}).click().catch(() => {});
    await tab.waitForFunction(() => Object.values(window.__mockPlayers).some(p => !p.destroyed && !p.muted));
    await tab.locator(`#yt-multiview-root .card:has(.title:text-is("Title ${IDS[4]}")) .remove`).click();
    await tab.locator('#yt-multiview-root input[type=url]').fill('https://youtu.be/failedVideo');
    await tab.locator('#yt-multiview-root button[type=submit]').click();
    await tab.locator('#yt-multiview-root .card-error:visible').waitFor();
    assert.equal(await tab.locator('#yt-multiview-root .chooser').isVisible(), false);
    assert.equal(await tab.locator('#yt-multiview-root .card:has(.card-error:visible) .audio').isDisabled(), true);
    assert.equal((await audible()).includes('failedVideo'), false);
    pass('failed window shows its error and cannot take the audio');

    // 12. Light theme follows YouTube.
    await tab.evaluate(() => document.documentElement.removeAttribute('dark'));
    await tab.waitForTimeout(400);
    assert.equal(await inPanel(() => document.getElementById('yt-multiview-root').dataset.theme), 'light');
    await tab.screenshot({path: path.join(OUT, '09-float-light.png')});
    pass('light theme follows YouTube');

    assert.deepEqual(errors, []);
    console.log(`\n${results.length} checks passed. Screenshots: ${OUT}`);
  } catch (error) {
    console.error('FAIL', error);
    console.error('page errors', errors);
    process.exitCode = 1;
  } finally {
    await context.close();
    server.close();
  }
})();
