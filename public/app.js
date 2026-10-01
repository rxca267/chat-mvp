const state = {
  token: localStorage.getItem('chat-token') || '',
  currentUser: null,
  conversations: [],
  selectedConversationId: null,
  messages: [],
  users: [],
  socket: null
};

const refs = {
  authView: document.getElementById('authView'),
  chatView: document.getElementById('chatView'),
  loginForm: document.getElementById('loginForm'),
  registerForm: document.getElementById('registerForm'),
  tabButtons: document.querySelectorAll('.tab-button'),
  conversationList: document.getElementById('conversationList'),
  messageList: document.getElementById('messageList'),
  messageInput: document.getElementById('messageInput'),
  sendButton: document.getElementById('sendButton'),
  groupMembers: document.getElementById('groupMembers'),
  groupName: document.getElementById('groupName'),
  createGroupButton: document.getElementById('createGroupButton'),
  logoutButton: document.getElementById('logoutButton'),
  chatHeader: document.getElementById('chatHeader')
};

function setAuthView(showAuth) {
  refs.authView.classList.toggle('hidden', !showAuth);
  refs.chatView.classList.toggle('hidden', showAuth);
}

function connectSocket() {
  if (state.socket) {
    state.socket.disconnect();
  }

  if (!state.token) return;

  state.socket = io({ auth: { token: state.token } });

  state.socket.on('conversation:message', (message) => {
    if (!message || !state.selectedConversationId) return;

    if (message.conversationId !== state.selectedConversationId) {
      loadConversations();
      return;
    }

    const exists = state.messages.some((entry) => entry.id === message.id);
    if (!exists) {
      state.messages.push(message);
      renderMessages();
      loadConversations();
    }
  });

  state.socket.on('read:update', ({ conversationId, messageId, userId, readBy }) => {
    if (conversationId !== state.selectedConversationId) return;

    state.messages = state.messages.map((message) => {
      if (message.id !== messageId) return message;
      return { ...message, readBy: readBy || message.readBy || [] };
    });

    renderMessages();

    if (userId !== state.currentUser?.id) {
      loadConversations();
    }
  });

  state.socket.on('presence:update', ({ userId, online }) => {
    const conversationItem = document.querySelector(`[data-user-id="${userId}"]`);
    if (conversationItem) {
      conversationItem.textContent = online ? 'online' : 'offline';
    }
  });
}

async function api(path, options = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...(options.headers || {})
  });

  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function loadUsers() {
  try {
    const data = await api('/api/users');
    state.users = data.users || [];
    renderGroupMembers();
  } catch (error) {
    console.error(error);
  }
}

function renderGroupMembers() {
  refs.groupMembers.innerHTML = '';

  state.users.forEach((user) => {
    const option = document.createElement('option');
    option.value = user.id;
    option.textContent = `${user.name} (${user.email})`;
    refs.groupMembers.appendChild(option);
  });
}

async function loadCurrentUser() {
  try {
    const data = await api('/api/me');
    state.currentUser = data.user;
    setAuthView(false);
    connectSocket();
    await Promise.all([loadConversations(), loadUsers()]);
    if (state.conversations.length) {
      selectConversation(state.conversations[0].id);
    }
  } catch (error) {
    state.currentUser = null;
    state.token = '';
    localStorage.removeItem('chat-token');
    setAuthView(true);
  }
}

async function loadConversations() {
  if (!state.token) return;

  try {
    const data = await api('/api/conversations');
    state.conversations = data.conversations || [];
    renderConversations();
  } catch (error) {
    console.error(error);
  }
}

function renderConversations() {
  if (!state.conversations.length) {
    refs.conversationList.innerHTML = '<div class="empty-state">No chats yet</div>';
    return;
  }

  refs.conversationList.innerHTML = state.conversations
    .map((conversation) => {
      const isActive = conversation.id === state.selectedConversationId;
      const lastMessage = conversation.lastMessage ? escapeHtml(conversation.lastMessage.content) : 'No messages yet';
      const lastTime = conversation.lastMessage
        ? new Date(conversation.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
      const unread = conversation.unreadCount > 0 ? `<span class="unread-pill">${conversation.unreadCount}</span>` : '';

      return `
        <button class="conversation-item ${isActive ? 'active' : ''}" data-conversation-id="${conversation.id}">
          <div>
            <div class="conversation-title">${escapeHtml(conversation.name)}</div>
            <div class="conversation-meta">
              <span>${lastMessage}</span>
              <span>${lastTime}</span>
            </div>
          </div>
          ${unread}
        </button>
      `;
    })
    .join('');

  refs.conversationList.querySelectorAll('.conversation-item').forEach((button) => {
    button.addEventListener('click', () => {
      selectConversation(button.dataset.conversationId);
    });
  });
}

async function selectConversation(conversationId) {
  state.selectedConversationId = conversationId;
  renderConversations();

  const selected = state.conversations.find((conversation) => conversation.id === conversationId);
  if (!selected) return;

  refs.chatHeader.innerHTML = `
    <h3>${escapeHtml(selected.name)}</h3>
    <span>${selected.members ? selected.members.length : 0} members</span>
  `;

  try {
    const data = await api(`/api/conversations/${conversationId}/messages`);
    state.messages = data.messages || [];
    renderMessages();
    await markConversationRead();
  } catch (error) {
    console.error(error);
  }
}

async function markConversationRead() {
  if (!state.selectedConversationId) return;

  const unreadMessageIds = (state.messages || [])
    .filter((message) => message.senderId !== state.currentUser.id && !(message.readBy || []).includes(state.currentUser.id))
    .map((message) => message.id);

  if (!unreadMessageIds.length) return;

  try {
    await api(`/api/conversations/${state.selectedConversationId}/read`, {
      method: 'POST',
      body: JSON.stringify({ messageIds: unreadMessageIds })
    });

    state.messages = state.messages.map((message) => {
      if (unreadMessageIds.includes(message.id)) {
        const value = Array.isArray(message.readBy) ? message.readBy : [];
        return { ...message, readBy: [...new Set([...value, state.currentUser.id])] };
      }
      return message;
    });

    renderMessages();
    await loadConversations();
  } catch (error) {
    console.error(error);
  }
}

function renderMessages() {
  if (!state.selectedConversationId) {
    refs.messageList.innerHTML = '<div class="empty-state">Select a chat</div>';
    return;
  }

  if (!state.messages.length) {
    refs.messageList.innerHTML = '<div class="empty-state">No messages yet</div>';
    return;
  }

  refs.messageList.innerHTML = state.messages
    .map((message) => {
      const sender = state.users.find((user) => user.id === message.senderId) || state.currentUser;
      const isMe = sender && state.currentUser && sender.id === state.currentUser.id;
      const readCount = Array.isArray(message.readBy) ? message.readBy.length : 0;
      const readText = readCount > 1 ? `Read by ${readCount}` : 'Sent';

      return `
        <div class="message-row ${isMe ? 'me' : ''}">
          <div class="message-bubble">
            <span class="message-sender">${escapeHtml(sender ? sender.name : 'Unknown')}</span>
            <div>${escapeHtml(message.content)}</div>
            <div class="message-time">${new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="read-tag">${readText}</div>
          </div>
        </div>
      `;
    })
    .join('');

  refs.messageList.scrollTop = refs.messageList.scrollHeight;
}

async function sendMessage() {
  if (!state.selectedConversationId) return;

  const content = refs.messageInput.value.trim();
  if (!content) return;

  try {
    await api(`/api/conversations/${state.selectedConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content })
    });

    refs.messageInput.value = '';
    await loadConversations();
  } catch (error) {
    console.error(error);
  }
}

async function createGroup() {
  const name = refs.groupName.value.trim();
  const selected = Array.from(refs.groupMembers.selectedOptions).map((option) => option.value);

  if (!name) {
    alert('Please enter a group name');
    return;
  }

  try {
    await api('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ name, members: selected, isGroup: true })
    });

    refs.groupName.value = '';
    refs.groupMembers.value = '';
    await loadConversations();
  } catch (error) {
    alert(error.message);
  }
}

function attachEvents() {
  refs.tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab;
      refs.tabButtons.forEach((entry) => entry.classList.toggle('active', entry === button));
      refs.loginForm.classList.toggle('active', tab === 'login');
      refs.registerForm.classList.toggle('active', tab === 'register');
    });
  });

  refs.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
      const data = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      state.token = data.token;
      localStorage.setItem('chat-token', data.token);
      state.currentUser = data.user;
      setAuthView(false);
      connectSocket();
      await Promise.all([loadConversations(), loadUsers()]);
      if (state.conversations.length) {
        selectConversation(state.conversations[0].id);
      }
    } catch (error) {
      alert(error.message);
    }
  });

  refs.registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;

    try {
      const data = await api('/api/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password })
      });

      state.token = data.token;
      localStorage.setItem('chat-token', data.token);
      state.currentUser = data.user;
      setAuthView(false);
      connectSocket();
      await Promise.all([loadConversations(), loadUsers()]);
      if (state.conversations.length) {
        selectConversation(state.conversations[0].id);
      }
    } catch (error) {
      alert(error.message);
    }
  });

  refs.sendButton.addEventListener('click', sendMessage);
  refs.messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      sendMessage();
    }
  });

  refs.createGroupButton.addEventListener('click', createGroup);
  refs.logoutButton.addEventListener('click', () => {
    state.token = '';
    state.currentUser = null;
    state.conversations = [];
    state.messages = [];
    state.selectedConversationId = null;
    localStorage.removeItem('chat-token');
    if (state.socket) state.socket.disconnect();
    setAuthView(true);
    refs.chatHeader.innerHTML = '';
    refs.messageList.innerHTML = '';
    refs.conversationList.innerHTML = '';
  });
}

attachEvents();

if (state.token) {
  loadCurrentUser();
} else {
  setAuthView(true);
}

window.addEventListener('beforeunload', () => {
  if (state.socket) {
    state.socket.disconnect();
  }
});
