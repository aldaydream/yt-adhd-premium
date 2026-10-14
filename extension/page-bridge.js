(() => {
  'use strict';
  if (globalThis.__YT_MULTI_VIEW_BRIDGE_INSTALLED__) return;
  globalThis.__YT_MULTI_VIEW_BRIDGE_INSTALLED__ = true;
  const {normalizeSession,AudioCoordinator,MAX_VIDEOS} = globalThis.YTMultiViewCore;
  const CHANNEL = 'YT_MULTI_VIEW_V1';
  const PAGE = 'page';
  const clientId = globalThis.__YT_MULTI_VIEW_CLIENT_ID__;
  if (!/^[a-p]{32}$/.test(clientId || '')) return;
  let active = null;
  let apiPromise = null;
  let apiPolicy = null;
  const errorMessages = {
    2: 'YouTube did not recognise this video. Check the link.',
    5: 'YouTube cannot play this video in this browser.',
    100: 'The video was removed, is private or is unavailable.',
    101: 'The owner does not allow playback on other sites.',
    150: 'The owner does not allow playback on other sites.',
    152: 'YouTube rejected the player identity. Reload the extension and the tab.',
    153: 'YouTube did not receive the extension identity. Close MultiView and open it again.'
  };
  const emit = (session, event, payload={}) => window.postMessage({channel:CHANNEL,kind:'event',sessionId:session.id,event,payload},location.origin);
  const isCurrent = session => active === session && !session.closed;
  const pagePlayer = () => document.getElementById('movie_player');
  const audioEvent = session => emit(session,'audio',{id:session.audio.selectedId,volume:session.audio.volume,page:session.audio.players.has(PAGE)});
  // YouTube allows one automatically playing player per page: only while no window plays or is starting.
  const busy = session => [...session.entries.values()].some(entry => entry.pending || entry.state === 1 || entry.state === 3);
  function pageState() {
    try {
      const player = pagePlayer();
      const data = player?.getVideoData?.();
      if (data?.video_id) return {videoId:data.video_id,time:Math.floor(player.getCurrentTime() || 0),playing:player.getPlayerState() === 1};
    } catch {}
    return null;
  }

  function pausePagePlayer() {
    try { pagePlayer()?.pauseVideo?.(); } catch {}
    document.querySelectorAll('#movie_player video').forEach(video=>{ try { video.pause(); } catch {} });
  }

  // In the main dock the page's own player is hidden: keep it paused. Feed hover previews are left alone.
  document.addEventListener('play', event=>{
    if (active && !active.closed && active.dock === 'main' && event.target?.closest?.('#movie_player')) {
      try { event.target.pause(); } catch {}
    }
  }, true);

  // With the panel on the right, the page's own player is one more audio source.
  function pageAdapter(player) {
    return {mute:()=>player.mute(), unMute:()=>player.unMute(), isMuted:()=>player.isMuted()};
  }

  function setDock(session, dock, announce) {
    session.dock = dock === 'right' ? 'right' : 'main';
    const player = pagePlayer();
    if (session.dock === 'main') {
      // The page video moves into the panel from the same moment.
      const resume = announce && location.pathname === '/watch' ? pageState() : null;
      if (resume) emit(session,'resume',resume);
      pausePagePlayer();
      if (session.audio.players.has(PAGE)) {
        session.audio.remove(PAGE);
        if (session.pageWasMuted === false) { try { player?.unMute?.(); } catch {} }
      }
    } else if (typeof player?.mute === 'function' && !session.audio.players.has(PAGE)) {
      try { session.pageWasMuted = player.isMuted(); } catch { session.pageWasMuted = null; }
      session.audio.add(PAGE, pageAdapter(player));
      if (session.audio.selectedId === null) session.audio.select(PAGE);
    }
  }

  function loadApi() {
    if (window.YT?.Player) return Promise.resolve();
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve,reject)=>{
      const script = document.createElement('script');
      let timer;
      let timeout;
      const finish = error => {
        clearInterval(timer); clearTimeout(timeout);
        script.removeEventListener('error',onError);
        if(error) { script.remove(); reject(error); } else resolve();
      };
      const onError = ()=>finish(new Error('Could not load the YouTube player API. Check the connection and content blockers.'));
      try {
        if (window.trustedTypes && !apiPolicy) {
          apiPolicy = window.trustedTypes.createPolicy('yt-multiview-api', {
            createScriptURL: value => {
              if(value !== 'https://www.youtube.com/iframe_api') throw new TypeError('Unsupported script URL');
              return value;
            }
          });
        }
        script.src = apiPolicy ? apiPolicy.createScriptURL('https://www.youtube.com/iframe_api') : 'https://www.youtube.com/iframe_api';
        const nonce = document.querySelector('script[nonce]')?.nonce;
        if(nonce) script.nonce = nonce;
        script.addEventListener('error',onError,{once:true});
        timer = setInterval(()=>{ if(window.YT?.Player) finish(); },100);
        timeout = setTimeout(()=>finish(new Error('The YouTube player API did not answer in 20 seconds. Open MultiView again.')),20000);
        document.head.append(script);
      } catch(error) {
        finish(new Error(`The page blocked the YouTube player API: ${error.message}`));
      }
    }).catch(error=>{ apiPromise=null; throw error; });
    return apiPromise;
  }

  function frameFor(id) {
    const root = document.getElementById('yt-multiview-root')?.shadowRoot;
    return [...(root?.querySelectorAll('iframe[data-mv-id]') || [])].find(frame=>frame.dataset.mvId===id);
  }

  /** video is already normalized by normalizeSession: valid videoId and startSeconds. */
  async function addVideo(session,video,autoplay) {
    if (!isCurrent(session) || session.entries.has(video.id) || session.entries.size >= MAX_VIDEOS) return;
    const entry = {video,player:null,ready:false,timer:null,state:-1,pending:autoplay && !busy(session),failed:false};
    session.entries.set(video.id,entry);
    try {
      await loadApi();
      if (!isCurrent(session) || session.entries.get(video.id) !== entry) return;
      const frame = frameFor(video.id);
      if(!frame?.isConnected) {
        session.entries.delete(video.id);
        emit(session,'error',{id:video.id,code:'frame',message:'The player window is gone. Remove it and add the video again.'});
        return;
      }
      // mv_client must stay the first parameter: the session network rule matches it.
      const source = new URL(`https://www.youtube-nocookie.com/embed/${video.videoId}`);
      source.searchParams.set('mv_client',clientId);
      source.searchParams.set('enablejsapi','1');
      source.searchParams.set('origin',location.origin);
      source.searchParams.set('autoplay',entry.pending ? '1' : '0');
      source.searchParams.set('playsinline','1');
      if(video.startSeconds) source.searchParams.set('start',String(video.startSeconds));
      frame.src = source.href;
      entry.player = new YT.Player(frame,{
        events:{
          onReady: event=>{
            if(!isCurrent(session) || session.entries.get(video.id) !== entry) { try {event.target.destroy();} catch {} return; }
            entry.ready=true; clearTimeout(entry.timer);
            // AudioCoordinator.add mutes the player first; only the selected player is unmuted.
            session.audio.add(video.id,event.target);
            let data={};
            try {data=event.target.getVideoData() || {};} catch {}
            emit(session,'ready',{id:video.id,title:String(data.title || '').slice(0,512),author:String(data.author || '').slice(0,256)});
            audioEvent(session);
          },
          onStateChange: event=>{
            entry.state = event.data;
            if (event.data !== -1 && event.data !== 5) entry.pending = false;
            if(isCurrent(session) && session.entries.get(video.id)===entry) emit(session,'state',{id:video.id,state:event.data});
          },
          onError: event=>{
            entry.pending = false;
            entry.failed = true;
            if(!isCurrent(session) || session.entries.get(video.id)!==entry) return;
            clearTimeout(entry.timer);
            // Keep the failed player in the coordinator so the periodic check keeps it muted.
            if(session.audio.selectedId===video.id) session.audio.select(null);
            emit(session,'error',{id:video.id,code:event.data,message:errorMessages[event.data] || `YouTube returned error ${event.data}. Try another video.`});
            audioEvent(session);
          },
          onAutoplayBlocked: ()=>{
            entry.pending = false;
            if(isCurrent(session)) emit(session,'state',{id:video.id,state:'blocked'});
          }
        }
      });
      entry.timer=setTimeout(()=>{
        entry.pending = false;
        if(isCurrent(session) && !entry.ready && session.entries.get(video.id)===entry) emit(session,'error',{id:video.id,code:'timeout',message:'The player did not answer. Check the connection and add the video again.'});
      },25000);
    } catch(error) {
      entry.pending = false;
      entry.failed = true;
      if(isCurrent(session)) emit(session,'error',{id:video.id,code:'api',message:error.message});
    }
  }

  function stop(session=active) {
    if(!session || session.closed) return;
    session.closed=true;
    clearInterval(session.tick);
    const restorePage = session.audio.players.has(PAGE) && session.pageWasMuted === false;
    session.audio.destroy();
    if (restorePage) { try { pagePlayer()?.unMute?.(); } catch {} }
    for(const entry of session.entries.values()) { clearTimeout(entry.timer); try {entry.player?.destroy();} catch {} }
    session.entries.clear();
    if(active===session) active=null;
    emit(session,'closed');
  }

  function start(id,payload) {
    stop();
    const normalized = normalizeSession(payload);
    const session = active = {id,closed:false,entries:new Map(),audio:new AudioCoordinator(normalized.volume),dock:'main',pageWasMuted:null};
    // The video the user was watching continues from the same moment inside the panel.
    const resume = pageState();
    setDock(session,normalized.dock,false);
    session.tick=setInterval(()=>{
      if(!isCurrent(session)) return;
      if(!document.getElementById('yt-multiview-root')) { stop(session); return; }
      const before = session.audio.selectedId;
      const hadPage = session.audio.players.has(PAGE);
      // A page player that appears later (back to a watch page) joins as a sound source.
      if (session.dock === 'right' && !hadPage) setDock(session,'right',false);
      session.audio.reconcile();
      if (session.audio.selectedId !== before || session.audio.players.has(PAGE) !== hadPage) audioEvent(session);
    },250);
    for (const video of normalized.videos) {
      const continued = session.dock === 'main' && resume?.videoId === video.videoId;
      void addVideo(session,continued ? {...video,startSeconds:resume.time} : video,continued && resume.playing);
    }
    audioEvent(session);
  }

  window.addEventListener('message',event=>{
    const message=event.data;
    if(event.source!==window || event.origin!==location.origin || message?.channel!==CHANNEL || message.kind!=='command' || typeof message.sessionId!=='string' || !/^[a-f0-9-]{36}$/.test(message.sessionId)) return;
    const payload=message.payload;
    if(!payload || typeof payload!=='object' || Array.isArray(payload)) return;
    try {
      if(message.command==='start') { start(message.sessionId,payload); return; }
      const session=active;
      if(!session || session.id!==message.sessionId || session.closed) return;
      switch(message.command) {
        case 'add': {
          const video=normalizeSession({videos:[payload.video]}).videos[0];
          if(video) void addVideo(session,video,payload.autoplay===true);
          break;
        }
        case 'remove': {
          if(typeof payload.id!=='string' || payload.id===PAGE) return;
          const entry=session.entries.get(payload.id);
          session.entries.delete(payload.id);
          session.audio.remove(payload.id);
          clearTimeout(entry?.timer);
          try {entry?.player?.destroy();} catch {}
          audioEvent(session);
          break;
        }
        case 'select': {
          const entry = session.entries.get(payload.id);
          if(payload.id===PAGE ? !session.audio.players.has(PAGE) : payload.id!==null && (!entry?.ready || entry.failed)) return;
          session.audio.select(payload.id);
          audioEvent(session);
          break;
        }
        case 'volume':
          if(typeof payload.volume!=='number' || !Number.isFinite(payload.volume)) return;
          session.audio.setVolume(payload.volume);
          audioEvent(session);
          break;
        case 'dock':
          setDock(session,payload.dock,true);
          audioEvent(session);
          break;
        case 'stop': stop(session); break;
      }
    } catch(error) {
      if(active) emit(active,'error',{id:null,code:'command',message:'A MultiView command failed. Close the panel and open it again.'});
    }
  });
  // The panel survives YouTube's in-page navigation. A full reload or tab close ends the session.
  window.addEventListener('pagehide',()=>stop());
})();
