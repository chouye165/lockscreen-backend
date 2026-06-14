// Cloudflare Worker - Lockscreen Backend
// Serves: static website (/) + API (/api/*) + WebSocket (/ws)

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';

const activeConnections = new Set();

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + ':lockscreen-app-salt-v1');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, storedHash) {
  const computed = await hashPassword(password);
  return computed === storedHash;
}

function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

async function getUnlockRequests(env) {
  try {
    const data = await env.LOCKSCREEN_KV.get('unlock_requests', { type: 'json' });
    return data || [];
  } catch (e) { return []; }
}

async function saveUnlockRequests(env, requests) {
  try {
    await env.LOCKSCREEN_KV.put('unlock_requests', JSON.stringify(requests));
  } catch (e) {}
}

async function getAdminUser(env) {
  try {
    return await env.LOCKSCREEN_KV.get('admin_user', { type: 'json' });
  } catch (e) { return null; }
}

async function ensureAdminUser(env) {
  const existing = await getAdminUser(env);
  if (!existing) {
    const hash = await hashPassword(ADMIN_PASSWORD);
    await env.LOCKSCREEN_KV.put('admin_user', JSON.stringify({
      id: 1,
      username: ADMIN_USERNAME,
      password: hash,
      created_at: new Date().toISOString()
    }));
  }
}

async function getLockscreenPassword(env) {
  try {
    return await env.LOCKSCREEN_KV.get('lockscreen_password', { type: 'json' });
  } catch (e) { return null; }
}

async function ensureLockscreenPassword(env) {
  const existing = await getLockscreenPassword(env);
  if (!existing) {
    const hash = await hashPassword(LOCKSCREEN_PASSWORD);
    await env.LOCKSCREEN_KV.put('lockscreen_password', JSON.stringify({
      password: hash,
      created_at: new Date().toISOString()
    }));
  }
}

// 临时密码存储
async function getTempPasswords(env) {
  try {
    const data = await env.LOCKSCREEN_KV.get('temp_passwords', { type: 'json' });
    return data || [];
  } catch (e) { return []; }
}

async function saveTempPasswords(env, list) {
  try {
    await env.LOCKSCREEN_KV.put('temp_passwords', JSON.stringify(list));
  } catch (e) {}
}

function broadcastMessage(message) {
  const messageStr = JSON.stringify(message);
  for (const ws of activeConnections) {
    try { ws.send(messageStr); } catch (e) { activeConnections.delete(ws); }
  }
}

async function handleWebSocket(request, env) {
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') return null;

  const webSocketPair = new WebSocketPair();
  const server = webSocketPair[1];
  const client = webSocketPair[0];

  server.accept();
  activeConnections.add(server);

  // 连接建立后，发送测试消息
  try {
    server.send(JSON.stringify({ type: 'connected', message: 'WebSocket 已连接', connections: activeConnections.size }));
  } catch (e) {}

  // 检查 KV 中是否有待处理的远程命令（解决多实例问题）
  // 只发送30秒内的命令，发送后立即清除 active 标志防止重复
  const now = Date.now();
  const CMD_TIMEOUT = 30 * 1000;
  try {
    const pendingLock = await env.LOCKSCREEN_KV.get('remote_lock', { type: 'json' });
    if (pendingLock && pendingLock.active && pendingLock.at) {
      const cmdTime = new Date(pendingLock.at).getTime();
      if ((now - cmdTime) < CMD_TIMEOUT) {
        server.send(JSON.stringify({ type: 'remote_lock', at: pendingLock.at, from: 'kv' }));
        // 发送后清除 active 标志，防止重复发送
        pendingLock.active = false;
        await env.LOCKSCREEN_KV.put('remote_lock', JSON.stringify(pendingLock));
      }
    }
  } catch (e) {}
  try {
    const pendingUnlock = await env.LOCKSCREEN_KV.get('remote_unlock', { type: 'json' });
    if (pendingUnlock && pendingUnlock.active && pendingUnlock.at) {
      const cmdTime = new Date(pendingUnlock.at).getTime();
      if ((now - cmdTime) < CMD_TIMEOUT) {
        server.send(JSON.stringify({ type: 'remote_unlock', at: pendingUnlock.at, from: 'kv' }));
        // 发送后清除 active 标志，防止重复发送
        pendingUnlock.active = false;
        await env.LOCKSCREEN_KV.put('remote_unlock', JSON.stringify(pendingUnlock));
      }
    }
  } catch (e) {}

  server.addEventListener('message', (event) => {
    try { JSON.parse(event.data); } catch (e) {}
  });

  server.addEventListener('close', () => {
    activeConnections.delete(server);
  });

  server.addEventListener('error', () => {
    activeConnections.delete(server);
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: { 'Access-Control-Allow-Origin': '*' }
  });
}

async function handleLogin(req, env) {
  const body = await req.json();
  const { username, password } = body;

  await ensureAdminUser(env);
  const user = await getAdminUser(env);

  if (!user || user.username !== username) {
    return jsonResponse({ success: false, message: '用户名或密码错误' }, 401);
  }

  const match = await verifyPassword(password, user.password);
  if (match) return jsonResponse({ success: true, token: uuidv4() });

  return jsonResponse({ success: false, message: '用户名或密码错误' }, 401);
}

async function handleCheckPassword(req, env) {
  const body = await req.json();
  const { password } = body;

  await ensureLockscreenPassword(env);
  const stored = await getLockscreenPassword(env);
  if (stored) {
    const match = await verifyPassword(password, stored.password);
    if (match) return jsonResponse({ success: true });
  }

  // 同时验证活跃的临时密码
  const tempPasswords = await getTempPasswords(env);
  for (const tp of tempPasswords) {
    if (!tp.active) continue;
    if (tp.expires_at && new Date(tp.expires_at) < new Date()) continue;
    const match = await verifyPassword(password, tp.password);
    if (match) return jsonResponse({ success: true });
  }

  return jsonResponse({ success: false });
}

async function handleRequestUnlock(req, env) {
  const body = await req.json();
  const { device_id, device_name } = body;
  const request_id = uuidv4();

  const requests = await getUnlockRequests(env);
  const newRequest = {
    id: requests.length + 1,
    request_id,
    device_id: device_id || 'unknown',
    device_name: device_name || 'Locked Computer',
    status: 'pending',
    created_at: new Date().toISOString(),
    approved_at: null
  };

  requests.push(newRequest);
  await saveUnlockRequests(env, requests);

  broadcastMessage({
    type: 'new_unlock_request',
    request_id,
    device_id: newRequest.device_id,
    device_name: newRequest.device_name
  });

  return jsonResponse({ success: true, request_id });
}

async function handleGetUnlockRequests(env) {
  const requests = await getUnlockRequests(env);
  const sorted = [...requests].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return jsonResponse(sorted);
}

async function handleApproveUnlock(req, env) {
  const body = await req.json();
  const { request_id } = body;

  const requests = await getUnlockRequests(env);
  const request = requests.find(r => r.request_id === request_id);

  if (request) {
    request.status = 'approved';
    request.approved_at = new Date().toISOString();
    await saveUnlockRequests(env, requests);
    broadcastMessage({ type: 'unlock_approved', request_id });
    return jsonResponse({ success: true });
  }

  return jsonResponse({ success: false, message: 'Request not found' }, 404);
}

async function handleDenyUnlock(req, env) {
  const body = await req.json();
  const { request_id } = body;

  const requests = await getUnlockRequests(env);
  const request = requests.find(r => r.request_id === request_id);

  if (request) {
    request.status = 'denied';
    await saveUnlockRequests(env, requests);
    broadcastMessage({ type: 'unlock_denied', request_id });
    return jsonResponse({ success: true });
  }

  return jsonResponse({ success: false, message: 'Request not found' }, 404);
}

async function handleDeleteRequest(req, env) {
  const body = await req.json();
  const { request_id } = body;

  const requests = await getUnlockRequests(env);
  const index = requests.findIndex(r => r.request_id === request_id);

  if (index !== -1) {
    requests.splice(index, 1);
    await saveUnlockRequests(env, requests);
    return jsonResponse({ success: true });
  }

  return jsonResponse({ success: false, message: 'Request not found' }, 404);
}

async function handleChangeAdmin(req, env) {
  const body = await req.json();
  const { old_password, new_username, new_password } = body;

  await ensureAdminUser(env);
  const user = await getAdminUser(env);
  if (!user) return jsonResponse({ success: false, message: '用户不存在' }, 400);

  // 验证原密码（必须提供）
  if (!old_password) {
    return jsonResponse({ success: false, message: '请输入原密码' }, 400);
  }
  const match = await verifyPassword(old_password, user.password);
  if (!match) return jsonResponse({ success: false, message: '原密码错误' }, 401);

  // 准备更新
  let updated = { ...user, updated_at: new Date().toISOString() };

  // 更新用户名（如果提供且有效）
  if (new_username !== undefined && new_username !== null && new_username !== '') {
    if (new_username.length < 2) {
      return jsonResponse({ success: false, message: '用户名至少2位' }, 400);
    }
    updated.username = new_username;
  }

  // 更新密码（如果提供且有效）
  if (new_password !== undefined && new_password !== null && new_password !== '') {
    if (new_password.length < 4) {
      return jsonResponse({ success: false, message: '新密码至少4位' }, 400);
    }
    updated.password = await hashPassword(new_password);
  }

  await env.LOCKSCREEN_KV.put('admin_user', JSON.stringify(updated));
  return jsonResponse({ success: true });
}

// 临时密码管理
async function handleGetTempPasswords(req, env) {
  const list = await getTempPasswords(env);
  // 返回时移除 hash 密码本体，只返回元信息
  const safeList = list.map(tp => ({
    id: tp.id,
    label: tp.label || '',
    active: tp.active,
    created_at: tp.created_at,
    expires_at: tp.expires_at || null
  }));
  return jsonResponse(safeList);
}

async function handleCreateTempPassword(req, env) {
  const body = await req.json();
  const { password, label, expires_hours } = body;

  if (!password || password.length < 4) {
    return jsonResponse({ success: false, message: '密码至少4位' }, 400);
  }

  const list = await getTempPasswords(env);
  const now = new Date();
  const newItem = {
    id: uuidv4(),
    label: label || '',
    password: await hashPassword(password),
    active: true,
    created_at: now.toISOString(),
    expires_at: expires_hours
      ? new Date(now.getTime() + Number(expires_hours) * 3600 * 1000).toISOString()
      : null
  };
  list.unshift(newItem);
  await saveTempPasswords(env, list);
  return jsonResponse({ success: true, id: newItem.id });
}

async function handleToggleTempPassword(req, env) {
  const body = await req.json();
  const { id, active } = body;

  const list = await getTempPasswords(env);
  const item = list.find(tp => tp.id === id);
  if (!item) return jsonResponse({ success: false, message: '未找到' }, 404);

  item.active = active === true || active === 'true';
  await saveTempPasswords(env, list);
  return jsonResponse({ success: true });
}

async function handleDeleteTempPassword(req, env) {
  const body = await req.json();
  const { id } = body;

  const list = await getTempPasswords(env);
  const filtered = list.filter(tp => tp.id !== id);
  if (filtered.length === list.length) {
    return jsonResponse({ success: false, message: '未找到' }, 404);
  }
  await saveTempPasswords(env, filtered);
  return jsonResponse({ success: true });
}

// 强制重置管理员账号（用于更新账号信息）
async function handleResetAdmin(req, env) {
  const hash = await hashPassword(ADMIN_PASSWORD);
  await env.LOCKSCREEN_KV.put('admin_user', JSON.stringify({
    id: 1,
    username: ADMIN_USERNAME,
    password: hash,
    created_at: new Date().toISOString()
  }));
  return jsonResponse({ success: true, message: '管理员已重置' });
}

// 远程锁定命令：向所有已连接的桌面客户端广播锁定消息 + 存储到 KV
async function handleRemoteLock(req, env) {
  // 同时广播 WebSocket 消息（针对同一实例连接的客户端）
  broadcastMessage({
    type: 'remote_lock',
    at: new Date().toISOString()
  });
  // 将命令写入 KV（跨实例传递，解决多实例问题）
  try {
    await env.LOCKSCREEN_KV.put('remote_lock', JSON.stringify({
      type: 'remote_lock',
      at: new Date().toISOString(),
      active: true
    }));
  } catch (e) {}
  return jsonResponse({ success: true, message: '已广播锁定命令', connections: activeConnections.size });
}

// 远程解锁命令：向所有已连接的桌面客户端广播解锁消息 + 存储到 KV
async function handleRemoteUnlock(req, env) {
  broadcastMessage({
    type: 'remote_unlock',
    at: new Date().toISOString()
  });
  try {
    await env.LOCKSCREEN_KV.put('remote_unlock', JSON.stringify({
      type: 'remote_unlock',
      at: new Date().toISOString(),
      active: true
    }));
  } catch (e) {}
  return jsonResponse({ success: true, message: '已广播解锁命令', connections: activeConnections.size });
}

async function serveStatic(request, env) {
  try {
    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }
  } catch (e) {}
  return new Response('Not Found', { status: 404 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (path === '/ws' || path === '/socket.io/') {
      const wsResponse = await handleWebSocket(request, env);
      if (wsResponse) return wsResponse;
    }

    if (path === '/health' && request.method === 'GET') {
      return jsonResponse({ status: 'ok', connections: activeConnections.size });
    }

    if (path.startsWith('/api/')) {
      try {
        if (path === '/api/login' && request.method === 'POST') return await handleLogin(request, env);
        if (path === '/api/check-password' && request.method === 'POST') return await handleCheckPassword(request, env);
        if (path === '/api/request-unlock' && request.method === 'POST') return await handleRequestUnlock(request, env);
        if (path === '/api/unlock-requests' && request.method === 'GET') return await handleGetUnlockRequests(env);
        if (path === '/api/approve-unlock' && request.method === 'POST') return await handleApproveUnlock(request, env);
        if (path === '/api/deny-unlock' && request.method === 'POST') return await handleDenyUnlock(request, env);
        if (path === '/api/delete-request' && request.method === 'POST') return await handleDeleteRequest(request, env);
        if (path === '/api/change-password' && request.method === 'POST') return await handleChangeAdmin(request, env);
        if (path === '/api/temp-passwords' && request.method === 'GET') return await handleGetTempPasswords(request, env);
        if (path === '/api/temp-passwords' && request.method === 'POST') return await handleCreateTempPassword(request, env);
        if (path === '/api/temp-passwords/toggle' && request.method === 'POST') return await handleToggleTempPassword(request, env);
        if (path === '/api/temp-passwords/delete' && request.method === 'POST') return await handleDeleteTempPassword(request, env);
        if (path === '/api/reset-admin' && request.method === 'POST') return await handleResetAdmin(request, env);
        if (path === '/api/remote-lock' && request.method === 'POST') return await handleRemoteLock(request, env);
        if (path === '/api/remote-unlock' && request.method === 'POST') return await handleRemoteUnlock(request, env);
        if (path === '/api/check-remote-command' && request.method === 'GET') {
          // 返回 KV 中存储的命令状态（供桌面端轮询使用）
          // 并在返回后清除 active 标志，防止重复处理
          try {
            const lockCmdRaw = await env.LOCKSCREEN_KV.get('remote_lock', { type: 'json' });
            const unlockCmdRaw = await env.LOCKSCREEN_KV.get('remote_unlock', { type: 'json' });
            // 深拷贝原始值用于返回（修改前的状态）
            const lockCmdForResponse = lockCmdRaw ? JSON.parse(JSON.stringify(lockCmdRaw)) : null;
            const unlockCmdForResponse = unlockCmdRaw ? JSON.parse(JSON.stringify(unlockCmdRaw)) : null;
            // 清除 active 标志后写回 KV
            if (lockCmdRaw && lockCmdRaw.active) {
              lockCmdRaw.active = false;
              await env.LOCKSCREEN_KV.put('remote_lock', JSON.stringify(lockCmdRaw));
            }
            if (unlockCmdRaw && unlockCmdRaw.active) {
              unlockCmdRaw.active = false;
              await env.LOCKSCREEN_KV.put('remote_unlock', JSON.stringify(unlockCmdRaw));
            }
            return jsonResponse({
              success: true,
              remote_lock: lockCmdForResponse,
              remote_unlock: unlockCmdForResponse
            });
          } catch (e) {
            return jsonResponse({ success: false, message: e.message }, 500);
          }
        }
        if (path === '/api/clear-commands' && request.method === 'POST') {
          // 清除所有远程命令（用于修复状态）
          try {
            await env.LOCKSCREEN_KV.delete('remote_lock');
            await env.LOCKSCREEN_KV.delete('remote_unlock');
            return jsonResponse({ success: true, message: '已清除所有命令' });
          } catch (e) {
            return jsonResponse({ success: false, message: e.message }, 500);
          }
        }
        return jsonResponse({ error: 'Not Found: ' + path }, 404);
      } catch (error) {
        return jsonResponse({ error: error.message || 'Internal Server Error' }, 500);
      }
    }

    return serveStatic(request, env);
  }
};
