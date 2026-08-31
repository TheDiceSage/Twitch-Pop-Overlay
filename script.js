const STORAGE_KEY = 'twitch-pop-overlay-settings';
const stage = document.getElementById('stage');
const panel = document.getElementById('panel');
const gear = document.getElementById('gear');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const hintEl = document.getElementById('hint');
const GROUP_COLORS = ['var(--g0)', 'var(--g1)', 'var(--g2)'];

let settings = {
  channel: '',
  groups: [
    { command: '!frogs', images: [], popAnimation: '', popAnimationDuration: 600 },
    { command: '!ghosts', images: [], popAnimation: '', popAnimationDuration: 600 },
    { command: '!coins', images: [], popAnimation: '', popAnimationDuration: 600 }
  ],
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

let activeImages = []; // { id, el, x, y, size, groupIndex, imageId }
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

function updateHintDisplay(){
  const parts = settings.groups
    .map((g, i) => ({ g, i }))
    .filter(({g}) => g.images.length && g.command)
    .map(({g, i}) => '<span class="cmd" style="color:' + GROUP_COLORS[i] + '">' + g.command + '</span>');
  if (parts.length && settings.showHint){
    hintEl.innerHTML = 'Type ' + parts.join('<span class="sep">/</span>') + ' to pop!';
    hintEl.style.display = 'block';
  } else {
    hintEl.style.display = 'none';
  }
}

function applySettingsToForm(){
  document.getElementById('channel').value = settings.channel;
  for (let i = 0; i < 3; i++){
    document.getElementById('g' + i + 'Command').value = settings.groups[i].command;
    document.getElementById('g' + i + 'Images').value = settings.groups[i].images.join('\n');
    document.getElementById('g' + i + 'PopFx').value = settings.groups[i].popAnimation || '';
    document.getElementById('g' + i + 'PopFxDuration').value = settings.groups[i].popAnimationDuration || 600;
  }
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
  settings.channel = document.getElementById('channel').value.trim().replace(/^#/, '');
  settings.groups = [0, 1, 2].map(i => ({
    command: (document.getElementById('g' + i + 'Command').value.trim() || ('!group' + (i + 1))),
    images: document.getElementById('g' + i + 'Images').value.split('\n').map(s => s.trim()).filter(Boolean),
    popAnimation: document.getElementById('g' + i + 'PopFx').value.trim(),
    popAnimationDuration: Math.min(5000, Math.max(100, parseInt(document.getElementById('g' + i + 'PopFxDuration').value) || 600))
  }));
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
        loaded.groups = [
          { command: loaded.popCommand, images: loaded.images },
          { command: '!ghosts', images: [] },
          { command: '!coins', images: [] }
        ];
        delete loaded.images;
        delete loaded.popCommand;
      }
      settings = Object.assign({}, settings, loaded);
      if (!settings.groups || settings.groups.length !== 3){
        settings.groups = [
          settings.groups && settings.groups[0] ? settings.groups[0] : { command: '!frogs', images: [] },
          settings.groups && settings.groups[1] ? settings.groups[1] : { command: '!ghosts', images: [] },
          settings.groups && settings.groups[2] ? settings.groups[2] : { command: '!coins', images: [] }
        ];
      }
      // Backfill popAnimation fields

      settings.groups = settings.groups.map(g => Object.assign({
        popAnimation: '', popAnimationDuration: 600
      }, g));
    }
  }catch(e){

    // no saved settings yet
  }
  applySettingsToForm();
}

// Spawns

function scheduleSpawn(){
  clearTimeout(spawnTimer);
  const delay = rand(settings.minInterval, settings.maxInterval) * 1000;
  spawnTimer = setTimeout(() => {
    trySpawn();
    scheduleSpawn();
  }, delay);
}

function trySpawn(forcedGroupIndex){
  if (activeImages.length >= settings.maxImages) return;

  let groupIndex = forcedGroupIndex;
  if (groupIndex === undefined){
    const eligible = settings.groups
      .map((g, i) => i)
      .filter(i => settings.groups[i].images.length);
    if (!eligible.length) return;
    groupIndex = eligible[Math.floor(Math.random() * eligible.length)];
  }

  const group = settings.groups[groupIndex];
  if (!group || !group.images.length) return;

  const url = group.images[Math.floor(Math.random() * group.images.length)];
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
  activeImages.push({ id, el: img, x, y, size, groupIndex, imageId: imageIdFromUrl(url) });
}

// Gets stable, readable id from image URL, e.g. ".../assets/frog1.png" -> "frog1"

function imageIdFromUrl(url){
  try{
    const clean = url.split('?')[0].split('#')[0];
    const filename = clean.split('/').filter(Boolean).pop() || clean;
    return filename.replace(/\.[a-zA-Z0-9]+$/, '') || clean;
  }catch(e){ return url; }
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

// plays pop effect with default burst, update with custom gif and duration if needed

function playPopFx(target){
  const group = settings.groups[target.groupIndex];
  const cx = target.x + target.size / 2;
  const cy = target.y + target.size / 2;

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
    const color = getComputedStyle(document.documentElement).getPropertyValue(
      ['--g0', '--g1', '--g2'][target.groupIndex] || '--purple-bright'
    );
    burstAt(cx, cy, color);
  }
}

function popOne(groupIndex, popper){
  const pool = groupIndex === undefined
    ? activeImages
    : activeImages.filter(i => i.groupIndex === groupIndex);
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

// Twitch Chat

function handleChatMessage(text, popper){
  const trimmed = text.trim().toLowerCase();
  const groupIndex = settings.groups.findIndex(g => g.command.trim().toLowerCase() === trimmed);
  if (groupIndex !== -1){
    popOne(groupIndex, popper);
  }
}

// Splits the raw IRC line into tags and the rest of the line

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

// Streamer.bot Websocket client

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
  sbWs.send(JSON.stringify({
    request: 'DoAction',
    action: { name: settings.streamerbot.actionName },
    args: {
      userId: popper.userId,
      userName: popper.userName,
      imageId: target.imageId,
      group: settings.groups[target.groupIndex] ? settings.groups[target.groupIndex].command : '',
      groupIndex: target.groupIndex
    },
    id: crypto.randomUUID()
  }));
}

// Panel Toggle

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
document.getElementById('testSpawn0').addEventListener('click', () => { readSettingsFromForm(); trySpawn(0); });
document.getElementById('testSpawn1').addEventListener('click', () => { readSettingsFromForm(); trySpawn(1); });
document.getElementById('testSpawn2').addEventListener('click', () => { readSettingsFromForm(); trySpawn(2); });

// Init

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