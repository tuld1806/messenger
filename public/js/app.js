// ─────────────────── STATE ───────────────────
const API = '';          // same origin
let token = localStorage.getItem('messenger_token') || null;
let me = JSON.parse(localStorage.getItem('messenger_user') || 'null');
let socket = null;
let currentChatBoxId = null;
let currentPartnerId = null;
let onlineUserIds = new Set();
let typingTimer = null;

// ─────────────────── AUTH FLOW ───────────────────
let isLoginMode = true;

document.getElementById('authToggleLink').addEventListener('click', e => {
  e.preventDefault();
  isLoginMode = !isLoginMode;
  document.getElementById('authSubmitBtn').textContent = isLoginMode ? 'Đăng nhập' : 'Đăng ký';
  document.getElementById('authToggleText').textContent = isLoginMode ? 'Chưa có tài khoản?' : 'Đã có tài khoản?';
  document.getElementById('authToggleLink').textContent = isLoginMode ? ' Đăng ký' : ' Đăng nhập';
  document.getElementById('inputName').style.display = isLoginMode ? 'none' : 'block';
  document.getElementById('authSubtitle').textContent = isLoginMode ? 'Đăng nhập để bắt đầu trò chuyện' : 'Tạo tài khoản mới';
  clearAuthError();
});

document.getElementById('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  clearAuthError();
  const username = document.getElementById('inputUsername').value.trim();
  const password = document.getElementById('inputPassword').value;
  const name = document.getElementById('inputName').value.trim();

  const endpoint = isLoginMode ? '/api/auth/login' : '/api/auth/register';
  const body = isLoginMode ? { username, password } : { username, password, name };

  try {
    const res = await fetch(`${API}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    saveSession(data.data.user, data.data.token);
    initApp();
  } catch (err) {
    showAuthError(err.message);
  }
});

function quickLogin(username, password) {
  document.getElementById('inputUsername').value = username;
  document.getElementById('inputPassword').value = password;
  isLoginMode = true;
  document.getElementById('authSubmitBtn').textContent = 'Đăng nhập';
  document.getElementById('authForm').requestSubmit();
}

function saveSession(user, tk) {
  me = user;
  token = tk;
  localStorage.setItem('messenger_token', tk);
  localStorage.setItem('messenger_user', JSON.stringify(user));
}

function clearSession() {
  me = null; token = null;
  localStorage.removeItem('messenger_token');
  localStorage.removeItem('messenger_user');
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.style.display = 'block';
}
function clearAuthError() {
  document.getElementById('authError').style.display = 'none';
}

// ─────────────────── INIT APP ───────────────────
function initApp() {
  if (!me || !token) return;

  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('appContainer').style.display = 'flex';

  // Populate my info
  document.getElementById('myName').textContent = me.name || me.username;
  document.getElementById('myAvatar').src = me.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${me.username}`;

  connectSocket();
  loadConversations();

  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('messageInput').addEventListener('keypress', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // Typing events
  document.getElementById('messageInput').addEventListener('input', () => {
    if (socket && currentChatBoxId) {
      socket.emit('typing', { chatBoxId: currentChatBoxId });
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        socket.emit('stop_typing', { chatBoxId: currentChatBoxId });
      }, 1500);
    }
  });

  // User search
  document.getElementById('searchInput').addEventListener('input', debounce(onSearch, 300));
}

function logout() {
  if (socket) socket.disconnect();
  clearSession();
  location.reload();
}

// ─────────────────── SOCKET.IO ───────────────────
function connectSocket() {
  socket = io({ auth: { token } });

  socket.on('connect', () => console.log('[Socket] Connected:', socket.id));
  socket.on('connect_error', err => console.error('[Socket] Error:', err.message));

  socket.on('user_status', ({ userId, status }) => {
    if (status === 'online') onlineUserIds.add(userId);
    else onlineUserIds.delete(userId);
    updateOnlineUI(userId, status);
  });

  socket.on('receive_message', result => {
    if (result.chatBoxId === currentChatBoxId) {
      appendMessage(result.message, false);
    }
    refreshConversationPreview(result);
  });

  socket.on('conversation_updated', result => {
    refreshConversationPreview(result);
  });

  socket.on('typing', ({ chatBoxId, username }) => {
    if (chatBoxId === currentChatBoxId) showTyping(`${username} đang gõ…`);
  });

  socket.on('stop_typing', ({ chatBoxId }) => {
    if (chatBoxId === currentChatBoxId) hideTyping();
  });
}

// ─────────────────── CONVERSATIONS ───────────────────
async function loadConversations() {
  try {
    const res = await apiFetch('/api/messages/conversations');
    const convs = res.data;
    renderConversations(convs);
  } catch (e) {
    console.error(e);
  }
}

function renderConversations(convs) {
  const list = document.getElementById('conversationList');
  if (!convs.length) {
    list.innerHTML = '<p style="text-align:center;color:#475569;padding:24px;font-size:13px;">Chưa có cuộc trò chuyện nào</p>';
    return;
  }
  list.innerHTML = convs.map(c => convItemHTML(c)).join('');
  list.querySelectorAll('.conv-item').forEach(el => {
    el.addEventListener('click', () => openChat(
      parseInt(el.dataset.chatboxId),
      parseInt(el.dataset.partnerId),
      el.dataset.partnerName,
      el.dataset.partnerAvatar
    ));
  });
}

function convItemHTML(c) {
  const partner = c.partner;
  const lastMsg = c.lastMessage;
  const isOnline = onlineUserIds.has(partner.id);
  const timeStr = lastMsg ? formatTime(lastMsg.createdAt) : '';
  const preview = lastMsg
    ? (lastMsg.sender?.id === me.id ? `Bạn: ${lastMsg.content}` : lastMsg.content)
    : 'Bắt đầu trò chuyện';

  return `
    <div class="conv-item" id="conv-${c.chatBoxId}"
      data-chatbox-id="${c.chatBoxId}"
      data-partner-id="${partner.id}"
      data-partner-name="${partner.name || partner.username}"
      data-partner-avatar="${partner.avatar || ''}">
      <div class="avatar-wrapper">
        <img class="user-avatar" src="${partner.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${partner.username}`}" style="width:46px;height:46px;" />
        <span class="status-dot ${isOnline ? 'online' : ''}" id="status-${partner.id}"></span>
      </div>
      <div class="conv-details">
        <div class="conv-name-row">
          <span class="conv-name">${partner.name || partner.username}</span>
          <span class="conv-time">${timeStr}</span>
        </div>
        <div class="conv-last-msg">${escHtml(preview)}</div>
      </div>
    </div>`;
}

function refreshConversationPreview(result) {
  loadConversations();
}

// ─────────────────── OPEN CHAT ───────────────────
async function openChat(chatBoxId, partnerId, partnerName, partnerAvatar) {
  currentChatBoxId = chatBoxId;
  currentPartnerId = partnerId;

  // Leave previous room
  if (socket) socket.emit('leave_chat', { chatBoxId: -1 });

  // Update active conv in sidebar
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
  const convEl = document.getElementById(`conv-${chatBoxId}`);
  if (convEl) convEl.classList.add('active');

  // Show partner info
  document.getElementById('partnerName').textContent = partnerName;
  document.getElementById('partnerAvatar').src = partnerAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${partnerName}`;
  const isOnline = onlineUserIds.has(partnerId);
  document.getElementById('partnerStatus').className = `status-dot ${isOnline ? 'online' : ''}`;
  document.getElementById('partnerOnlineStatus').textContent = isOnline ? '● Trực tuyến' : 'Ngoại tuyến';
  document.getElementById('partnerOnlineStatus').style.color = isOnline ? '#10b981' : '#64748b';

  // Show chat panel
  document.getElementById('emptyChatState').style.display = 'none';
  document.getElementById('chatPanel').style.display = 'flex';

  // Join socket room
  if (socket) socket.emit('join_chat', { chatBoxId });

  // Load messages
  try {
    const res = await apiFetch(`/api/messages/history/${chatBoxId}`);
    const messages = res.data.messages;
    renderMessages(messages);
  } catch (e) {
    console.error(e);
  }

  document.getElementById('messageInput').focus();
}

function renderMessages(messages) {
  const body = document.getElementById('messagesBody');
  body.innerHTML = messages.map(m => msgHTML(m)).join('');
  body.scrollTop = body.scrollHeight;
}

function appendMessage(msg, shouldScroll = true) {
  const body = document.getElementById('messagesBody');
  body.insertAdjacentHTML('beforeend', msgHTML(msg));
  if (shouldScroll) body.scrollTop = body.scrollHeight;
}

function msgHTML(m) {
  const isSent = m.senderId === me.id || m.sender?.id === me.id;
  return `
    <div class="message-bubble ${isSent ? 'sent' : 'received'}">
      ${escHtml(m.content)}
      <div class="message-time">${formatTime(m.createdAt)}</div>
    </div>`;
}

// ─────────────────── SEND MESSAGE ───────────────────
function sendMessage() {
  const input = document.getElementById('messageInput');
  const content = input.value.trim();
  if (!content || !currentChatBoxId) return;
  input.value = '';

  // Send via Socket.IO for realtime broadcast
  socket.emit('send_message', { chatBoxId: currentChatBoxId, content }, result => {
    if (result.success) {
      appendMessage(result.data.message);
    }
  });
  socket.emit('stop_typing', { chatBoxId: currentChatBoxId });
}

// ─────────────────── USER SEARCH ───────────────────
async function onSearch(e) {
  const query = e.target.value.trim();
  if (!query) { loadConversations(); return; }

  try {
    const res = await apiFetch(`/api/users/search?q=${encodeURIComponent(query)}`);
    const users = res.data;
    renderUserSearchResults(users);
  } catch (e) {
    console.error(e);
  }
}

function renderUserSearchResults(users) {
  const list = document.getElementById('conversationList');
  if (!users.length) {
    list.innerHTML = '<p style="text-align:center;color:#475569;padding:24px;font-size:13px;">Không tìm thấy người dùng</p>';
    return;
  }
  list.innerHTML = users.map(u => `
    <div class="conv-item user-result" data-user-id="${u.id}" data-user-name="${u.name || u.username}" data-user-avatar="${u.avatar || ''}">
      <div class="avatar-wrapper">
        <img class="user-avatar" src="${u.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`}" style="width:46px;height:46px;" />
        <span class="status-dot ${onlineUserIds.has(u.id) ? 'online' : ''}"></span>
      </div>
      <div class="conv-details">
        <div class="conv-name-row">
          <span class="conv-name">${u.name || u.username}</span>
        </div>
        <div class="conv-last-msg" style="color:#3b82f6">@${u.username}</div>
      </div>
    </div>`).join('');

  list.querySelectorAll('.user-result').forEach(el => {
    el.addEventListener('click', async () => {
      const uid = parseInt(el.dataset.userId);
      const name = el.dataset.userName;
      const avatar = el.dataset.userAvatar;
      // Get or create chatbox
      try {
        const res = await apiFetch('/api/messages/chatbox', {
          method: 'POST',
          body: JSON.stringify({ recipientId: uid }),
        });
        const chatBox = res.data;
        document.getElementById('searchInput').value = '';
        await loadConversations();
        openChat(chatBox.id, uid, name, avatar);
      } catch (e) { console.error(e); }
    });
  });
}

// ─────────────────── ONLINE STATUS UI ───────────────────
function updateOnlineUI(userId, status) {
  const dot = document.getElementById(`status-${userId}`);
  if (dot) dot.className = `status-dot ${status === 'online' ? 'online' : ''}`;
  if (userId === currentPartnerId) {
    document.getElementById('partnerStatus').className = `status-dot ${status === 'online' ? 'online' : ''}`;
    document.getElementById('partnerOnlineStatus').textContent = status === 'online' ? '● Trực tuyến' : 'Ngoại tuyến';
    document.getElementById('partnerOnlineStatus').style.color = status === 'online' ? '#10b981' : '#64748b';
  }
}

// ─────────────────── TYPING ───────────────────
function showTyping(text) {
  const el = document.getElementById('typingIndicator');
  el.textContent = text;
  el.style.display = 'block';
}
function hideTyping() {
  document.getElementById('typingIndicator').style.display = 'none';
}

// ─────────────────── HELPERS ───────────────────
async function apiFetch(url, options = {}) {
  const res = await fetch(`${API}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'API Error');
  return data;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function debounce(fn, delay) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ─────────────────── BOOT ───────────────────
if (me && token) {
  initApp();
}
