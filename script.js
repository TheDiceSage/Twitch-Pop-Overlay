const STORAGE_KEY = 'twitch-pop-overlay-settings';
const stage = document.getElementById('stage');
const panel = document.getElementById('panel');
const gear = document.getElementById('gear');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const hintEl = document.getElementById('hint');
const groupsContainer = document.getElementById('groupsContainer');

// Colors cycle through this palette as groups are added, staying within the blue/grey scheme.
const GROUP_COLORS = ['#89CFF0', '#9aa0aa', '#5b7c8f', '#c7d9e8', '#71797E', '#4f7a96'];

function newGroup(){
  return {
    id: crypto.randomUUID(),
    command: '',
    images: [''],
    popAnimation: '',
    popAnimationDuration: 600,
    popSound: '',
    popSoundVolume: 100
  };
}

let settings = {
  channel: '',
  groups: [newGroup()],
  minInterval: 5,
  maxInterval: 15,
  size: 80,
  maxImages: 6,
  removalOrder: 'oldest',
  showHint: true,
  streamerbot: {
    enabled: false,
    host: '127.0.0.1',
    port: 8080,
    actionName: 'ImagePop'
  }
};

let activeImages = []; // { id, el, x, y, size, groupId, imageId }
let ws = null;
let spawnTimer = null;
let reconnectTimer = null;
let sbWs = null;
let sbReconnectTimer = null;

function rand(min, max){ return Math.random() * (max - min) + min; }

function setStatus(state, label){
  statusEl.className = 'status ' + state;
  statusText.textContent = label;
}

function groupColor(gi){
  return GROUP_COLORS[gi % GROUP_COLORS.length];
}

function escapeAttr(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function updateHintDisplay(){
  const parts = settings.groups
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => g.command && g.images.some(l => l.trim()))
    .map(({ g, i }) => '<span class="cmd" style="color:' + groupColor(i) + '">' + g.command + '</span>');
  if (parts.length && settings.showHint){
    hintEl.innerHTML = 'Type ' + parts.join('<span class="sep">/</span>') + ' to pop!';
    hintEl.style.display = 'block';
  } else {
    hintEl.style.display = 'none';
  }
}

// ---------- Dynamic group rendering ----------

function groupTemplate(group, gi){
  const color = groupColor(gi);
  const canRemoveGroup = settings.groups.length > 1;
  const imagesHtml = group.images.map((url, ii) => `
    <div class="imgline">
      <input type="text" class="imgInput" data-g="${group.id}" data-i="${ii}" value="${escapeAttr(url)}" placeholder="${ii === 0 ? 'https://example.com/image1.gif' : 'https://example.com/rare.gif|0.2'}">
      ${group.images.length > 1 ? `<button type="button" class="iconbtn removeImg" data-g="${group.id}" data-i="${ii}" title="Remove line">&times;</button>` : ''}
    </div>
  `).join('');

  return `
  <div class="group" style="--g:${color}" data-g="${group.id}">
    <div class="grouptitle">
      <span class="swatch"></span><span>Group ${gi + 1}</span>
      ${canRemoveGroup ? `<button type="button" class="iconbtn removeGroup" data-g="${group.id}" title="Remove group">&times;</button>` : ''}
    </div>
    <label>Pop command</label>
    <input type="text" class="cmdInput" data-g="${group.id}" value="${escapeAttr(group.command)}" placeholder="!group${gi + 1}">
    <label>Image or GIF URLs</label>
    <div class="imagelines">${imagesHtml}</div>
    <button type="button" class="addbtn addImg" data-g="${group.id}">+ Add image source</button>
    <div class="hint-small">Add <b>|weight</b> after a URL to change how often it spawns (default 1). Lower = rarer, e.g. <b>|0.2</b> spawns 5x less than default.</div>
    <label>Pop animation GIF (optional)</label>
    <input type="text" class="fxInput" data-g="${group.id}" value="${escapeAttr(group.popAnimation)}" placeholder="https://example.com/pop.gif">
    <label>Pop animation duration (ms)</label>
    <input type="number" class="fxDurationInput" data-g="${group.id}" min="100" max="5000" value="${group.popAnimationDuration}">
    <label>Pop sound effect (optional)</label>
    <input type="text" class="soundInput" data-g="${group.id}" value="${escapeAttr(group.popSound)}" placeholder="https://example.com/pop.mp3">
    <label>Sound volume (%)</label>
    <input type="number" class="soundVolInput" data-g="${group.id}" min="0" max="100" value="${group.popSoundVolume}">
    <div class="grouptestrow">
      <button type="button" class="action ghost small testSpawnBtn" data-g="${group.id}">Test Spawn</button>
      <button type="button" class="action ghost small testPopBtn" data-g="${group.id}">Test Pop</button>
    </div>
  </div>`;
}

function findGroup(groupId){
  return settings.groups.find(g => g.id === groupId);
}

function renderGroups(){
  groupsContainer.innerHTML = settings.groups.map((g, gi) => groupTemplate(g, gi)).join('');
  hookGroupInputs();
  updateHintDisplay();
}

function hookGroupInputs(){
  groupsContainer.querySelectorAll('.cmdInput').forEach(el => {
    el.addEventListener('input', () => {
      findGroup(el.dataset.g).command = el.value;
      updateHintDisplay();
    });
  });
  groupsContainer.querySelectorAll('.imgInput').forEach(el => {
    el.addEventListener('input', () => {
      findGroup(el.dataset.g).images[+el.dataset.i] = el.value;
      updateHintDisplay();
    });
  });
  groupsContainer.querySelectorAll('.fxInput').forEach(el => {
    el.addEventListener('input', () => { findGroup(el.dataset.g).popAnimation = el.value; });
  });
  groupsContainer.querySelectorAll('.fxDurationInput').forEach(el => {
    el.addEventListener('input', () => {
      const v = parseInt(el.value);
      findGroup(el.dataset.g).popAnimationDuration = isNaN(v) ? 600 : Math.min(5000, Math.max(100, v));
    });
  });
  groupsContainer.querySelectorAll('.soundInput').forEach(el => {
    el.addEventListener('input', () => { findGroup(el.dataset.g).popSound = el.value; });
  });
  groupsContainer.querySelectorAll('.soundVolInput').forEach(el => {
    el.addEventListener('input', () => {
      const v = parseInt(el.value);
      findGroup(el.dataset.g).popSoundVolume = isNaN(v) ? 100 : Math.min(100, Math.max(0, v));
    });
  });
  groupsContainer.querySelectorAll('.addImg').forEach(el => {
    el.addEventListener('click', () => {
      findGroup(el.dataset.g).images.push('');
      renderGroups();
    });
  });
  groupsContainer.querySelectorAll('.removeImg').forEach(el => {
    el.addEventListener('click', () => {
      findGroup(el.dataset.g).images.splice(+el.dataset.i, 1);
      renderGroups();
    });
  });
  groupsContainer.querySelectorAll('.removeGroup').forEach(el => {
    el.addEventListener('click', () => {
      settings.groups = settings.groups.filter(g => g.id !== el.dataset.g);
      renderGroups();
    });
  });
  groupsContainer.querySelectorAll('.testSpawnBtn').forEach(el => {
    el.addEventListener('click', () => trySpawn(el.dataset.g));
  });
  groupsContainer.querySelectorAll('.testPopBtn').forEach(el => {
    el.addEventListener('click', () => popOne(el.dataset.g));
  });
}

document.getElementById('addGroupBtn').addEventListener('click', () => {
  settings.groups.push(newGroup());
  renderGroups();
});

function applySettingsToForm(){
  document.getElementById('channel').value = settings.channel;
  renderGroups();
  document.getElementById('minInterval').value = settings.minInterval;
  document.getElementById('maxInterval').value = settings.maxInterval;
  document.getElementById('size').value = settings.size;
  document.getElementById('maxImages').value = settings.maxImages;
  document.getElementById('removalOrder').value = settings.removalOrder;
  document.getElementById('showHint').checked = settings.showHint;
  document.getElementById('sbEnabled').checked = settings.streamerbot.enabled;
  document.getElementById('sbHost').value = settings.streamerbot.host;
  document.getElementById('sbPort').value = settings.streamerbot.port;
  document.getElementById('sbAction').value = settings.streamerbot.actionName;
  updateHintDisplay();
}

function readSettingsFromForm(){
  // Groups are already kept in sync live via input listeners in hookGroupInputs.
  settings.channel = document.getElementById('channel').value.trim().replace(/^#/, '');
  settings.minInterval = Math.max(1, parseFloat(document.getElementById('minInterval').value) || 5);
  settings.maxInterval = Math.max(settings.minInterval, parseFloat(document.getElementById('maxInterval').value) || 15);
  settings.size = Math.min(400, Math.max(16, parseInt(document.getElementById('size').value) || 80));
  settings.maxImages = Math.min(40, Math.max(1, parseInt(document.getElementById('maxImages').value) || 6));
  settings.removalOrder = document.getElementById('removalOrder').value;
  settings.showHint = document.getElementById('showHint').checked;
  settings.streamerbot = {
    enabled: document.getElementById('sbEnabled').checked,
    host: document.getElementById('sbHost').value.trim() || '127.0.0.1',
    port: parseInt(document.getElementById('sbPort').value) || 8080,
    actionName: document.getElementById('sbAction').value.trim() || 'ImagePop'
  };
  updateHintDisplay();
}

async function saveSettings(){
  try{
    await window.storage.set(STORAGE_KEY, JSON.stringify(settings), false);
  }catch(e){ console.error('Failed to save settings', e); }
}

async function loadSettings(){
  try{
    const result = await window.storage.get(STORAGE_KEY, false);
    if (result && result.value){
      const loaded = JSON.parse(result.value);
      // Migrate old single-group format if present
      if (loaded.images && loaded.popCommand && !loaded.groups){
        loaded.groups = [{ command: loaded.popCommand, images: loaded.images }];
        delete loaded.images;
        delete loaded.popCommand;
      }
      settings = Object.assign({}, settings, loaded);
      if (!settings.groups || !settings.groups.length){
        settings.groups = [newGroup()];
      }
      // Backfill fields for settings saved before dynamic groups / popAnimation / popSound existed
      settings.groups = settings.groups.map(g => Object.assign(
        { id: crypto.randomUUID(), popAnimation: '', popAnimationDuration: 600, popSound: '', popSoundVolume: 100 },
        g,
        { images: (g.images && g.images.length) ? g.images : [''] }
      ));
    }
  }catch(e){
    // no saved settings yet, that's fine
  }
  applySettingsToForm();
}

// ---------- Spawning ----------

function scheduleSpawn(){
  clearTimeout(spawnTimer);
  const delay = rand(settings.minInterval, settings.maxInterval) * 1000;
  spawnTimer = setTimeout(() => {
    trySpawn();
    scheduleSpawn();
  }, delay);
}

function trySpawn(forcedGroupId){
  if (activeImages.length >= settings.maxImages) return;

  let group;
  if (forcedGroupId !== undefined){
    group = findGroup(forcedGroupId);
    if (!group) return;
  } else {
    const eligible = settings.groups.filter(g => g.images.some(l => l.trim()));
    if (!eligible.length) return;
    group = eligible[Math.floor(Math.random() * eligible.length)];
  }

  const parsedImages = group.images.filter(l => l.trim()).map(parseImageLine);
  if (!parsedImages.length) return;
  const url = pickWeighted(parsedImages).url;
  if (!url) return;

  const size = settings.size;
  const maxX = Math.max(0, window.innerWidth - size);
  const bottomMargin = 8; // gap between image bottom and viewport edge
  const x = rand(0, maxX);
  const y = window.innerHeight - size - bottomMargin;

  const img = document.createElement('img');
  img.src = url;
  img.className = 'critter';
  img.style.width = size + 'px';
  img.style.height = size + 'px';
  img.style.left = x + 'px';
  img.style.top = y + 'px';
  stage.appendChild(img);
  requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add('in')));

  const id = crypto.randomUUID();
  activeImages.push({ id, el: img, x, y, size, groupId: group.id, imageId: imageIdFromUrl(url) });
}

// Parses an image line, which may optionally end in "|weight" to control spawn rarity.
// Weight defaults to 1 when omitted. Lower weight = spawns less often relative to others.
// e.g. "https://x.com/rare.gif|0.2" spawns 5x less often than a default-weight (1) image.
function parseImageLine(line){
  const pipeIdx = line.lastIndexOf('|');
  if (pipeIdx === -1) return { url: line.trim(), weight: 1 };
  const url = line.slice(0, pipeIdx).trim();
  const weightStr = line.slice(pipeIdx + 1).trim();
  const weight = parseFloat(weightStr);
  return { url, weight: (!isNaN(weight) && weight > 0) ? weight : 1 };
}

// Weighted random pick from an array of { url, weight } entries.
function pickWeighted(entries){
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  if (total <= 0) return entries[Math.floor(Math.random() * entries.length)];
  let r = Math.random() * total;
  for (const e of entries){
    if (r < e.weight) return e;
    r -= e.weight;
  }
  return entries[entries.length - 1];
}

// Derives a stable, readable id from an image URL, e.g. ".../assets/frog1.png" -> "frog1"
function imageIdFromUrl(url){
  try{
    const clean = url.split('?')[0].split('#')[0];
    const filename = clean.split('/').filter(Boolean).pop() || clean;
    return filename.replace(/\.[a-zA-Z0-9]+$/, '') || clean;
  }catch(e){ return url; }
}

// Plays a short sound effect. Each call uses a fresh Audio instance so overlapping
// pops (e.g. two people popping the same group quickly) don't cut each other off.
function playPopSound(url, volumePercent){
  try{
    const audio = new Audio(url);
    audio.volume = Math.min(100, Math.max(0, volumePercent != null ? volumePercent : 100)) / 100;
    audio.play().catch(e => console.warn('Pop sound failed to play:', e));
  }catch(e){
    console.warn('Pop sound error:', e);
  }
}

function burstAt(x, y, color){
  const burst = document.createElement('div');
  burst.className = 'burst';
  burst.style.left = x + 'px';
  burst.style.top = y + 'px';
  for (let i = 0; i < 8; i++){
    const p = document.createElement('span');
    if (color) p.style.background = color;
    const angle = (Math.PI * 2 * i) / 8;
    const dist = 24 + Math.random() * 16;
    p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
    p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
    burst.appendChild(p);
  }
  stage.appendChild(burst);
  setTimeout(() => burst.remove(), 550);
}

// Plays the pop effect for a given target: its group's custom GIF/sound if set, otherwise the default particle burst.
function playPopFx(target){
  const group = findGroup(target.groupId);
  const cx = target.x + target.size / 2;
  const cy = target.y + target.size / 2;

  if (group && group.popSound){
    playPopSound(group.popSound, group.popSoundVolume);
  }

  if (group && group.popAnimation){
    const fx = document.createElement('img');
    fx.src = group.popAnimation;
    fx.className = 'popfx';
    const fxSize = target.size * 1.2;
    fx.style.width = fxSize + 'px';
    fx.style.height = fxSize + 'px';
    fx.style.left = cx + 'px';
    fx.style.top = cy + 'px';
    stage.appendChild(fx);
    const duration = (group.popAnimationDuration || 600);
    setTimeout(() => fx.classList.add('fading'), Math.max(0, duration - 200));
    setTimeout(() => fx.remove(), duration);
  } else {
    const gi = settings.groups.findIndex(g => g.id === target.groupId);
    const color = gi !== -1 ? groupColor(gi) : '#89CFF0';
    burstAt(cx, cy, color);
  }
}

function popOne(groupId, popper){
  const pool = groupId === undefined
    ? activeImages
    : activeImages.filter(i => i.groupId === groupId);
  if (!pool.length) return;

  let target;
  if (settings.removalOrder === 'oldest'){
    target = pool[0];
  } else {
    target = pool[Math.floor(Math.random() * pool.length)];
  }
  activeImages = activeImages.filter(i => i.id !== target.id);
  target.el.classList.remove('in');
  target.el.classList.add('out');
  playPopFx(target);
  setTimeout(() => target.el.remove(), 300);

  if (popper){
    reportPopToStreamerbot(target, popper);
  }
}

// ---------- Twitch chat (anonymous IRC over WebSocket) ----------

function handleChatMessage(text, popper){
  const trimmed = text.trim().toLowerCase();
  const group = settings.groups.find(g => g.command.trim().toLowerCase() === trimmed && trimmed !== '');
  if (group){
    popOne(group.id, popper);
  }
}

// Splits a raw IRC line into its IRCv3 tags (if present) and the rest of the line.
function parseIrcTags(line){
  if (!line.startsWith('@')) return { tags: {}, rest: line };
  const spaceIdx = line.indexOf(' ');
  const tagStr = line.slice(1, spaceIdx);
  const tags = {};
  tagStr.split(';').forEach(pair => {
    const eq = pair.indexOf('=');
    if (eq !== -1) tags[pair.slice(0, eq)] = pair.slice(eq + 1);
  });
  return { tags, rest: line.slice(spaceIdx + 1) };
}

function parsePrivmsg(rest){
  const idx = rest.indexOf(' PRIVMSG ');
  if (idx === -1) return null;
  const loginMatch = rest.match(/^:([^!]+)!/);
  const after = rest.slice(idx + 9);
  const colon = after.indexOf(' :');
  if (colon === -1) return null;
  return { text: after.slice(colon + 2), login: loginMatch ? loginMatch[1] : '' };
}

function connectTwitch(){
  if (!settings.channel){
    setStatus('error', 'No channel set');
    return;
  }
  clearTimeout(reconnectTimer);
  if (ws){ try{ ws.onclose = null; ws.close(); }catch(e){} }

  setStatus('connecting', 'Connecting to #' + settings.channel + '…');
  const nick = 'justinfan' + Math.floor(10000 + Math.random() * 90000);
  ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

  ws.onopen = () => {
    ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    ws.send('PASS SCHMOOPIIE');
    ws.send('NICK ' + nick);
    ws.send('JOIN #' + settings.channel.toLowerCase());
  };

  ws.onmessage = (evt) => {
    const lines = String(evt.data).split('\r\n').filter(Boolean);
    for (const line of lines){
      if (line.startsWith('PING')){
        ws.send('PONG :tmi.twitch.tv');
        continue;
      }
      const { tags, rest } = parseIrcTags(line);
      if (rest.includes(' 001 ') || rest.includes(' JOIN ')){
        setStatus('connected', 'Connected to #' + settings.channel);
      }
      if (rest.includes('PRIVMSG')){
        const parsed = parsePrivmsg(rest);
        if (parsed !== null){
          const popper = {
            userId: tags['user-id'] || '',
            userName: tags['display-name'] || parsed.login
          };
          handleChatMessage(parsed.text, popper);
        }
      }
    }
  };

  ws.onerror = () => setStatus('error', 'Connection error');

  ws.onclose = () => {
    setStatus('error', 'Disconnected — retrying…');
    reconnectTimer = setTimeout(connectTwitch, 4000);
  };
}

function disconnectTwitch(){
  clearTimeout(reconnectTimer);
  if (ws){ try{ ws.onclose = null; ws.close(); }catch(e){} ws = null; }
  setStatus('', 'Not connected');
}

// ---------- Streamer.bot WebSocket client ----------

const sbStatusEl = document.getElementById('sbStatus');

function setSbStatus(text){
  if (sbStatusEl) sbStatusEl.textContent = text;
}

function connectStreamerbot(){
  if (!settings.streamerbot.enabled) return;
  clearTimeout(sbReconnectTimer);
  if (sbWs){ try{ sbWs.onclose = null; sbWs.close(); }catch(e){} }

  const url = 'ws://' + settings.streamerbot.host + ':' + settings.streamerbot.port + '/';
  setSbStatus('Connecting to Streamer.bot…');
  sbWs = new WebSocket(url);

  sbWs.onopen = () => setSbStatus('Connected to Streamer.bot');
  sbWs.onerror = () => setSbStatus('Connection error — check host/port');
  sbWs.onclose = () => {
    setSbStatus('Disconnected — retrying…');
    sbReconnectTimer = setTimeout(connectStreamerbot, 4000);
  };
}

function disconnectStreamerbot(){
  clearTimeout(sbReconnectTimer);
  if (sbWs){ try{ sbWs.onclose = null; sbWs.close(); }catch(e){} sbWs = null; }
  setSbStatus('Not connected');
}

// Sends a DoAction request to Streamer.bot with details of who popped which image.
function reportPopToStreamerbot(target, popper){
  if (!settings.streamerbot.enabled) return;
  if (!sbWs || sbWs.readyState !== WebSocket.OPEN) return;
  const group = findGroup(target.groupId);
  sbWs.send(JSON.stringify({
    request: 'DoAction',
    action: { name: settings.streamerbot.actionName },
    args: {
      userId: popper.userId,
      userName: popper.userName,
      imageId: target.imageId,
      group: group ? group.command : '',
      groupId: target.groupId
    },
    id: crypto.randomUUID()
  }));
}

// ---------- Panel toggling ----------

function togglePanel(force){
  const open = typeof force === 'boolean' ? force : !panel.classList.contains('open');
  panel.classList.toggle('open', open);
}

gear.addEventListener('click', () => togglePanel());

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement && document.activeElement.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (!typing && (e.key === 's' || e.key === 'S')){
    togglePanel();
  }
});

document.getElementById('saveConnect').addEventListener('click', async () => {
  readSettingsFromForm();
  await saveSettings();
  connectTwitch();
  if (settings.streamerbot.enabled){
    connectStreamerbot();
  } else {
    disconnectStreamerbot();
  }
});

document.getElementById('disconnect').addEventListener('click', () => {
  disconnectTwitch();
  disconnectStreamerbot();
});

// ---------- Init ----------

(async function init(){
  await loadSettings();
  scheduleSpawn();
  if (settings.channel){
    connectTwitch();
  } else {
    togglePanel(true);
  }
  if (settings.streamerbot.enabled){
    connectStreamerbot();
  }
})();