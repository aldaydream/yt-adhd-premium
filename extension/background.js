/* All privileged code is packaged locally. Network identity is limited to our own embed frames. */
'use strict';
const clickQueues = new Map();
const ruleForTab = (tabId) => ({
  id: tabId,
  priority: 1,
  action: {type: 'modifyHeaders', requestHeaders: [{header: 'Referer', operation: 'set', value: `https://adhd-multiview.${chrome.runtime.id}/`}]},
  condition: {
    tabIds: [tabId],
    // Keep RE2 under Chromium's 2KB compiled-rule limit. Video IDs are validated in core.js.
    regexFilter: `^https://www\\.youtube-nocookie\\.com/embed/.{11}\\?mv_client=${chrome.runtime.id}&`,
    resourceTypes: ['sub_frame']
  }
});

function isYouTubePage(url) {
  try {
    const parsed = new URL(url);
    // The panel docks on watch pages and floats over any other YouTube page. Embed pages are players, not pages.
    return parsed.origin === 'https://www.youtube.com' && !parsed.pathname.startsWith('/embed/');
  } catch { return false; }
}

async function clearRule(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [tabId]});
}

async function setBadge(tabId, text, title) {
  await chrome.action.setBadgeText({tabId, text});
  await chrome.action.setBadgeBackgroundColor({tabId, color: text === '!' ? '#b3261e' : '#374151'});
  if (title) await chrome.action.setTitle({tabId, title});
}

async function toggle(tab) {
  if (!Number.isInteger(tab?.id) || tab.id < 1) return;
  if (!isYouTubePage(tab.url)) {
    await setBadge(tab.id, 'YT', 'Open a YouTube page and click MultiView again.');
    return;
  }
  try {
    await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[tab.id],addRules:[ruleForTab(tab.id)]});
    await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:(clientId)=>{ globalThis.__YT_MULTI_VIEW_CLIENT_ID__ = clientId; },args:[chrome.runtime.id]});
    await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:['core.js','page-bridge.js']});
    await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',files:['core.js','content.js']});
    const response = await chrome.tabs.sendMessage(tab.id,{type:'MV_TOGGLE'});
    if (!response?.ok) throw new Error('The page did not answer. Reload the YouTube tab.');
    await setBadge(tab.id,'','ADHD MultiView: open or close the panel');
  } catch (error) {
    await clearRule(tab.id).catch(()=>{});
    await setBadge(tab.id,'!',`MultiView: ${error.message || error} Reload the tab and try again.`).catch(()=>{});
    console.error('ADHD MultiView activation failed:',error);
  }
}

function queueTask(tabId, task) {
  const previous = clickQueues.get(tabId) || Promise.resolve();
  const current = previous.catch(()=>{}).then(task);
  clickQueues.set(tabId,current);
  current.finally(()=>{ if(clickQueues.get(tabId) === current) clickQueues.delete(tabId); }).catch(()=>{});
  return current;
}

function queueToggle(tab) {
  if (!Number.isInteger(tab?.id)) return Promise.resolve();
  return queueTask(tab.id,()=>toggle(tab));
}

async function releaseIfClosed(tabId) {
  // Tabs without our rule were never activated: do not inject anything there.
  const rules = await chrome.declarativeNetRequest.getSessionRules().catch(()=>[]);
  if (!rules.some(rule=>rule.id === tabId)) return;
  const result = await chrome.scripting.executeScript({target:{tabId},func:()=>Boolean(document.getElementById('yt-multiview-root'))}).catch(()=>[]);
  if (!result[0]?.result) await clearRule(tabId);
}

chrome.action.onClicked.addListener(tab=>{ void queueToggle(tab); });
chrome.tabs.onRemoved.addListener(tabId=>{ void queueTask(tabId,()=>clearRule(tabId)).catch(()=>{}); });
chrome.tabs.onUpdated.addListener((tabId,change)=>{
  if (change.status === 'loading' || change.url) void queueTask(tabId,()=>releaseIfClosed(tabId)).catch(()=>{});
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if (message?.type !== 'MV_RELEASE' || sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.id) return false;
  queueTask(sender.tab.id,async()=>{
    // A late close from the previous session must not remove a newly opened session's rule.
    await releaseIfClosed(sender.tab.id);
    respond({ok:true});
  }).catch(()=>respond({ok:false}));
  return true;
});

// Local diagnostics and browser verification run the same handler as a toolbar click.
globalThis.__YT_MULTI_VIEW_BACKGROUND__ = Object.freeze({toggle:queueToggle,ruleForTab,isYouTubePage});
