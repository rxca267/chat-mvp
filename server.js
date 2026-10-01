const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'chat.json');
const JWT_SECRET = process.env.JWT_SECRET || 'chat-dev-secret';

const onlineUsers = new Set();

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_PATH)) {
    const seed = {
      users: [],
      conversations: [],
      messages: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
  }
}

function loadDb() {
  ensureStorage();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : []
    };
  } catch (error) {
    return { users: [], conversations: [], messages: [] };
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function getDb() {
  return loadDb();
}

function getUserById(userId) {
  const db = getDb();
  return db.users.find((user) => user.id === userId) || null;
}

function generateToken(user) {
  return jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

function getConversationById(conversationId) {
  const db = getDb();
  return db.conversations.find((conversation) => conversation.id === conversationId) || null;
}

function getMessagesForConversation(conversationId) {
  const db = getDb();
  return db.messages
    .filter((message) => message.conversationId === conversationId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function getUserPublic(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  };
}

function userIsMember(userId, conversation) {
  return Array.isArray(conversation.memberIds) && conversation.memberIds.includes(userId);
}

function buildConversationSummary(conversation, meId) {
  const db = getDb();
  const members = db.users.filter((user) => conversation.memberIds.includes(user.id));
  const messages = getMessagesForConversation(conversation.id);
  const lastMessage = messages[messages.length - 1] || null;
  const unreadCount = messages.filter((message) => {
    const isMine = message.senderId === meId;
    const isRead = Array.isArray(message.readBy) && message.readBy.includes(meId);
    return !isMine && !isRead;
  }).length;

  return {
    id: conversation.id,
    name: conversation.name,
    isGroup: conversation.isGroup,
    createdAt: conversation.createdAt,
    memberIds: conversation.memberIds,
    members: members.map(getUserPublic),
    lastMessage,
    unreadCount
  };
}

function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = getUserById(payload.userId);

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  const db = getDb();
  const emailExists = db.users.some((user) => user.email.toLowerCase() === String(email).trim().toLowerCase());

  if (emailExists) {
    return res.status(409).json({ error: 'User already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    passwordHash,
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  saveDb(db);

  const token = generateToken(user);
  res.json({ token, user: getUserPublic(user) });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const db = getDb();
  const user = db.users.find((entry) => entry.email.toLowerCase() === String(email).trim().toLowerCase());

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = generateToken(user);
  res.json({ token, user: getUserPublic(user) });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: getUserPublic(req.user) });
});

app.get('/api/users', requireAuth, (req, res) => {
  const db = getDb();
  const users = db.users
    .filter((user) => user.id !== req.user.id)
    .map(getUserPublic);
  res.json({ users });
});

app.get('/api/conversations', requireAuth, (req, res) => {
  const db = getDb();
  const conversations = db.conversations
    .filter((conversation) => userIsMember(req.user.id, conversation))
    .map((conversation) => buildConversationSummary(conversation, req.user.id));

  conversations.sort((a, b) => {
    const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : new Date(a.createdAt).getTime();
    const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : new Date(b.createdAt).getTime();
    return bTime - aTime;
  });

  res.json({ conversations });
});

app.post('/api/conversations', requireAuth, (req, res) => {
  const { name, members = [], isGroup = true } = req.body || {};
  const db = getDb();

  const participantIds = Array.from(new Set([
    req.user.id,
    ...members.map((id) => String(id)).filter(Boolean)
  ]));

  if (!participantIds.length) {
    return res.status(400).json({ error: 'At least one member is required' });
  }

  const conversation = {
    id: uuidv4(),
    name: String(name || 'New chat').trim() || 'New chat',
    isGroup: Boolean(isGroup),
    memberIds: participantIds,
    createdAt: new Date().toISOString()
  };

  db.conversations.push(conversation);
  saveDb(db);

  res.status(201).json({ conversation: buildConversationSummary(conversation, req.user.id) });
});

app.get('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const conversation = getConversationById(req.params.id);
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  if (!userIsMember(req.user.id, conversation)) {
    return res.status(403).json({ error: 'Not a member of this conversation' });
  }

  const messages = getMessagesForConversation(conversation.id).map((message) => ({
    ...message,
    readBy: Array.isArray(message.readBy) ? message.readBy : []
  }));

  res.json({ messages });
});

app.post('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const { content } = req.body || {};
  const conversation = getConversationById(req.params.id);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  if (!userIsMember(req.user.id, conversation)) {
    return res.status(403).json({ error: 'Not a member of this conversation' });
  }

  if (!content || !String(content).trim()) {
    return res.status(400).json({ error: 'Message content is required' });
  }

  const db = getDb();
  const message = {
    id: uuidv4(),
    conversationId: conversation.id,
    senderId: req.user.id,
    content: String(content).trim(),
    createdAt: new Date().toISOString(),
    readBy: [req.user.id]
  };

  db.messages.push(message);
  saveDb(db);

  io.to(conversation.id).emit('conversation:message', message);
  res.status(201).json({ message });
});

app.post('/api/conversations/:id/read', requireAuth, (req, res) => {
  const { messageIds = [] } = req.body || {};
  const conversation = getConversationById(req.params.id);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  if (!userIsMember(req.user.id, conversation)) {
    return res.status(403).json({ error: 'Not a member of this conversation' });
  }

  const db = getDb();
  let updated = [];

  db.messages = db.messages.map((message) => {
    if (message.conversationId !== conversation.id || !messageIds.includes(message.id)) {
      return message;
    }

    const nextReadBy = Array.isArray(message.readBy) ? message.readBy : [];
    if (!nextReadBy.includes(req.user.id)) {
      nextReadBy.push(req.user.id);
    }

    const updatedMessage = { ...message, readBy: nextReadBy };
    updated.push({ messageId: message.id, userId: req.user.id, readBy: nextReadBy });
    return updatedMessage;
  });

  saveDb(db);

  updated.forEach((item) => {
    io.to(conversation.id).emit('read:update', {
      conversationId: conversation.id,
      messageId: item.messageId,
      userId: req.user.id,
      readBy: item.readBy
    });
  });

  res.json({ ok: true, updated });
});

app.get('/api/conversations/:id', requireAuth, (req, res) => {
  const conversation = getConversationById(req.params.id);

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  if (!userIsMember(req.user.id, conversation)) {
    return res.status(403).json({ error: 'Not a member of this conversation' });
  }

  res.json({ conversation: buildConversationSummary(conversation, req.user.id) });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Missing token'));
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = getUserById(payload.userId);

    if (!user) {
      return next(new Error('User not found'));
    }

    socket.user = user;
    return next();
  } catch (error) {
    return next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  onlineUsers.add(userId);
  io.emit('presence:update', { userId, online: true });

  socket.on('joinConversation', ({ conversationId }) => {
    if (!conversationId) return;
    socket.join(conversationId);
    io.to(conversationId).emit('presence:update', { userId, online: true, conversationId });
  });

  socket.on('leaveConversation', ({ conversationId }) => {
    if (conversationId) {
      socket.leave(conversationId);
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
    io.emit('presence:update', { userId, online: false });
  });
});

server.listen(PORT, () => {
  console.log(`Chat app listening on http://localhost:${PORT}`);
});
