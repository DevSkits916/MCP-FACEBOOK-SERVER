const state = {
  adminToken: localStorage.getItem('mcpAdminToken') || '',
  pages: [],
  logs: [],
  logAbort: null,
  logConnected: false,
  activePanel: 'connection',
};

const elements = {
  workerUrl: document.getElementById('workerUrl'),
  healthStatus: document.getElementById('healthStatus'),
  mcpStatus: document.getElementById('mcpStatus'),
  sseStatus: document.getElementById('sseStatus'),
  refreshConnection: document.getElementById('refreshConnection'),
  adminTokenInput: document.getElementById('adminTokenInput'),
  applyAdminToken: document.getElementById('applyAdminToken'),
  clearAdminToken: document.getElementById('clearAdminToken'),
  adminTokenStatus: document.getElementById('adminTokenStatus'),
  authUser: document.getElementById('authUser'),
  authExpiry: document.getElementById('authExpiry'),
  authMessage: document.getElementById('authMessage'),
  startOAuth: document.getElementById('startOAuth'),
  revokeAuth: document.getElementById('revokeAuth'),
  pagesList: document.getElementById('pagesList'),
  reloadPages: document.getElementById('reloadPages'),
  pageSelect: document.getElementById('pageSelect'),
  pagePostForm: document.getElementById('pagePostForm'),
  postMessage: document.getElementById('postMessage'),
  postLink: document.getElementById('postLink'),
  postImage: document.getElementById('postImage'),
  postResult: document.getElementById('postResult'),
  settingsForm: document.getElementById('settingsForm'),
  settingsOrigins: document.getElementById('settingsOrigins'),
  settingsRate: document.getElementById('settingsRate'),
  flagVerboseLogging: document.getElementById('flagVerboseLogging'),
  settingsStatus: document.getElementById('settingsStatus'),
  consoleOutput: document.getElementById('consoleOutput'),
  logLevelFilter: document.getElementById('logLevelFilter'),
  logToolFilter: document.getElementById('logToolFilter'),
  reconnectLogs: document.getElementById('reconnectLogs'),
};

function updateAdminStatus(message = '') {
  elements.adminTokenInput.value = state.adminToken;
  if (state.adminToken) {
    elements.adminTokenStatus.textContent = message || 'Admin token applied. Requests will include Authorization header.';
  } else {
    elements.adminTokenStatus.textContent = message || 'Not required unless configured.';
  }
}

function buildHeaders(init) {
  const headers = new Headers(init || {});
  if (state.adminToken) {
    headers.set('Authorization', `Bearer ${state.adminToken}`);
  }
  return headers;
}

async function apiFetch(path, options = {}) {
  const init = { ...options };
  init.headers = buildHeaders(options.headers);
  if (init.body && !init.headers.has('Content-Type')) {
    init.headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(path, init);
  if (response.status === 401) {
    throw new Error('Unauthorized (check admin token)');
  }
  return response;
}

function setStatus(element, status, text) {
  element.textContent = text;
  element.classList.remove('ok', 'error', 'warn', 'unknown');
  element.classList.add(status);
}

async function refreshConnection() {
  elements.workerUrl.textContent = window.location.origin;
  await Promise.all([checkHealth(), checkMcp(), checkSse()]);
}

async function checkHealth() {
  setStatus(elements.healthStatus, 'unknown', 'Checking…');
  try {
    const response = await apiFetch('/health');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    setStatus(elements.healthStatus, 'ok', `OK (${body.version || 'dev'})`);
  } catch (error) {
    setStatus(elements.healthStatus, 'error', error.message);
  }
}

async function checkMcp() {
  setStatus(elements.mcpStatus, 'unknown', 'Checking…');
  try {
    const payload = { id: crypto.randomUUID(), tool: 'echo', params: { ping: Date.now() } };
    const response = await apiFetch('/mcp', { method: 'POST', body: JSON.stringify(payload) });
    const body = await response.json();
    if (body.status !== 'ok') throw new Error(body.error?.message || 'Tool error');
    setStatus(elements.mcpStatus, 'ok', 'Ready');
  } catch (error) {
    setStatus(elements.mcpStatus, 'error', error.message);
  }
}

async function checkSse() {
  setStatus(elements.sseStatus, 'unknown', 'Checking…');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await apiFetch('/mcp/sse', {
      method: 'GET',
      signal: controller.signal,
      headers: buildHeaders({ Accept: 'text/event-stream' }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setStatus(elements.sseStatus, 'ok', 'Reachable');
  } catch (error) {
    if (error.name === 'AbortError') {
      setStatus(elements.sseStatus, 'ok', 'Reachable');
    } else {
      setStatus(elements.sseStatus, 'error', error.message);
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function callTool(tool, params) {
  const payload = { id: crypto.randomUUID(), tool, params };
  const response = await apiFetch('/mcp', { method: 'POST', body: JSON.stringify(payload) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body.status !== 'ok') {
    const message = body.error?.message || 'Tool error';
    throw new Error(message);
  }
  return body.result;
}

async function loadAuthState() {
  try {
    const result = await callTool('fb.me');
    elements.authUser.textContent = `${result.name} (${result.id})`;
    if (result.expires_at) {
      const date = new Date(result.expires_at * 1000);
      elements.authExpiry.textContent = `${date.toLocaleString()} (${timeUntil(date)})`;
    } else {
      elements.authExpiry.textContent = 'Long-lived token';
    }
    elements.authMessage.textContent = '';
  } catch (error) {
    elements.authUser.textContent = 'Not linked';
    elements.authExpiry.textContent = '—';
    elements.authMessage.textContent = error.message;
  }
}

function timeUntil(date) {
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return 'expired';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

async function startOAuth() {
  try {
    const response = await apiFetch('/oauth/start', {
      headers: buildHeaders({ Accept: 'application/json' }),
    });
    if (response.redirected) {
      window.open(response.url, '_blank');
      return;
    }
    const body = await response.json();
    if (!body.url) throw new Error('Missing OAuth URL');
    window.open(body.url, '_blank', 'noopener');
    elements.authMessage.textContent = 'Follow the Facebook flow, then return to refresh.';
  } catch (error) {
    elements.authMessage.textContent = error.message;
  }
}

async function revokeAuth() {
  try {
    const response = await apiFetch('/api/auth/revoke', { method: 'POST' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    elements.authMessage.textContent = 'Token revoked.';
    await loadAuthState();
  } catch (error) {
    elements.authMessage.textContent = error.message;
  }
}

async function loadPages() {
  try {
    const pages = await callTool('fb.page_list');
    state.pages = pages;
    renderPages();
  } catch (error) {
    state.pages = [];
    renderPages(error.message);
  }
}

function renderPages(errorMessage) {
  elements.pagesList.innerHTML = '';
  elements.pageSelect.innerHTML = '<option value="" disabled selected>Select a page</option>';
  if (errorMessage) {
    const li = document.createElement('li');
    li.textContent = errorMessage;
    elements.pagesList.appendChild(li);
    return;
  }
  state.pages.forEach((page) => {
    const li = document.createElement('li');
    li.textContent = `${page.name} (${page.id})`;
    elements.pagesList.appendChild(li);
    const option = document.createElement('option');
    option.value = page.id;
    option.textContent = page.name;
    elements.pageSelect.appendChild(option);
  });
}

async function submitPost(event) {
  event.preventDefault();
  const pageId = elements.pageSelect.value;
  if (!pageId) {
    elements.postResult.textContent = 'Select a page first.';
    return;
  }
  const message = elements.postMessage.value.trim();
  const link = elements.postLink.value.trim() || undefined;
  const image = elements.postImage.value.trim() || undefined;
  elements.postResult.textContent = 'Posting…';
  try {
    const result = await callTool('fb.page_post', {
      page_id: pageId,
      message,
      link,
      image_url: image,
    });
    const url = result.permalink_url ? ` — ${result.permalink_url}` : '';
    elements.postResult.textContent = `Post created (${result.id})${url}`;
    elements.postMessage.value = '';
    elements.postLink.value = '';
    elements.postImage.value = '';
  } catch (error) {
    elements.postResult.textContent = `Failed: ${error.message}`;
  }
}

async function loadSettings() {
  try {
    const response = await apiFetch('/api/settings');
    const body = await response.json();
    elements.settingsOrigins.value = (body.allowedOrigins || []).join('\n');
    elements.settingsRate.value = body.rateLimitPerMinute || '';
    elements.flagVerboseLogging.checked = Boolean(body.featureFlags?.verboseLogging);
    elements.settingsStatus.textContent = '';
  } catch (error) {
    elements.settingsStatus.textContent = error.message;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const origins = elements.settingsOrigins.value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const payload = {
    allowedOrigins: origins,
    rateLimitPerMinute: Number(elements.settingsRate.value) || undefined,
    featureFlags: {
      verboseLogging: elements.flagVerboseLogging.checked,
    },
  };
  elements.settingsStatus.textContent = 'Saving…';
  try {
    const response = await apiFetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    elements.settingsStatus.textContent = 'Saved!';
    await refreshConnection();
  } catch (error) {
    elements.settingsStatus.textContent = error.message;
  }
}

function connectLogStream() {
  if (state.logAbort) {
    state.logAbort.abort();
  }
  const controller = new AbortController();
  state.logAbort = controller;
  state.logConnected = false;
  state.logs = [];
  renderLogs();

  (async () => {
    try {
      const response = await apiFetch('/api/logs/stream', {
        headers: buildHeaders({ Accept: 'text/event-stream' }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          handleSseChunk(chunk);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        pushLog({
          ts: new Date().toISOString(),
          level: 'warn',
          message: `Log stream disconnected: ${error.message}`,
        });
        setTimeout(connectLogStream, 5000);
      }
    }
  })();
}

function handleSseChunk(chunk) {
  const lines = chunk.split('\n');
  let event = 'message';
  let data = '';
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data += line.slice(5).trimStart() + '\n';
    }
  }
  if (!data) return;
  try {
    const payload = JSON.parse(data);
    if (event === 'ready') {
      pushLog({ ts: new Date().toISOString(), level: 'info', message: 'Log stream connected' });
      state.logConnected = true;
    } else if (event === 'log') {
      pushLog(payload);
    }
  } catch (error) {
    pushLog({ ts: new Date().toISOString(), level: 'warn', message: 'Failed to parse log event' });
  }
}

function pushLog(entry) {
  state.logs.push(entry);
  if (state.logs.length > 500) {
    state.logs.splice(0, state.logs.length - 500);
  }
  renderLogs();
}

function renderLogs() {
  const levelFilter = elements.logLevelFilter.value;
  const toolFilter = elements.logToolFilter.value.trim().toLowerCase();
  const fragment = document.createDocumentFragment();
  const filtered = state.logs.filter((entry) => {
    if (levelFilter !== 'all' && entry.level !== levelFilter) return false;
    if (toolFilter && entry.tool && !entry.tool.toLowerCase().includes(toolFilter)) return false;
    if (toolFilter && !entry.tool) return false;
    return true;
  });
  filtered.slice(-200).forEach((entry) => {
    fragment.appendChild(renderLogEntry(entry));
  });
  elements.consoleOutput.innerHTML = '';
  elements.consoleOutput.appendChild(fragment);
  elements.consoleOutput.scrollTop = elements.consoleOutput.scrollHeight;
}

function renderLogEntry(entry) {
  const wrapper = document.createElement('div');
  wrapper.className = 'log-entry';
  const meta = document.createElement('div');
  meta.className = 'meta';
  const level = document.createElement('span');
  level.className = `log-level-${entry.level || 'info'}`;
  level.textContent = entry.level || 'info';
  const ts = document.createElement('span');
  ts.textContent = new Date(entry.ts).toLocaleTimeString();
  meta.append(level, ts);
  if (entry.tool) {
    const tool = document.createElement('span');
    tool.textContent = entry.tool;
    meta.append(tool);
  }
  if (entry.reqId) {
    const req = document.createElement('span');
    req.textContent = entry.reqId;
    meta.append(req);
  }
  const message = document.createElement('div');
  message.className = 'message';
  message.textContent = entry.message;
  wrapper.append(meta, message);
  if (entry.details) {
    const details = document.createElement('pre');
    details.textContent = JSON.stringify(entry.details, null, 2);
    wrapper.append(details);
  }
  return wrapper;
}

function bindNavigation() {
  const buttons = document.querySelectorAll('.nav-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (!target) return;
      buttons.forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === `panel-${target}`);
      });
      state.activePanel = target;
    });
  });
}

function initAdminControls() {
  updateAdminStatus();
  elements.applyAdminToken.addEventListener('click', () => {
    state.adminToken = elements.adminTokenInput.value.trim();
    if (state.adminToken) {
      localStorage.setItem('mcpAdminToken', state.adminToken);
      updateAdminStatus('Saved locally.');
    } else {
      localStorage.removeItem('mcpAdminToken');
      updateAdminStatus('Cleared token.');
    }
    refreshAll();
  });
  elements.clearAdminToken.addEventListener('click', () => {
    state.adminToken = '';
    localStorage.removeItem('mcpAdminToken');
    updateAdminStatus('Cleared token.');
    refreshAll();
  });
}

function refreshAll() {
  refreshConnection();
  loadAuthState();
  loadPages();
  loadSettings();
  connectLogStream();
}

function initEvents() {
  elements.refreshConnection.addEventListener('click', refreshConnection);
  elements.startOAuth.addEventListener('click', startOAuth);
  elements.revokeAuth.addEventListener('click', revokeAuth);
  elements.reloadPages.addEventListener('click', loadPages);
  elements.pagePostForm.addEventListener('submit', submitPost);
  elements.settingsForm.addEventListener('submit', saveSettings);
  elements.logLevelFilter.addEventListener('change', renderLogs);
  elements.logToolFilter.addEventListener('input', renderLogs);
  elements.reconnectLogs.addEventListener('click', connectLogStream);
}

(function init() {
  elements.workerUrl.textContent = window.location.origin;
  bindNavigation();
  initAdminControls();
  initEvents();
  refreshAll();
})();
