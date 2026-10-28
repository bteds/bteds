const express = require('express')
const session = require('express-session')
const SQLiteStore = require('connect-sqlite3')(session)
const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 3000
const isProduction = process.env.NODE_ENV === 'production'
const dataDir = path.join(__dirname, 'data')
fs.mkdirSync(dataDir, { recursive: true })

const db = new Database(path.join(dataDir, 'campus.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, post_id)
);
`)

const postCount = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n
if (postCount === 0) {
  const demoUser = db.prepare('SELECT id FROM users WHERE username = ?').get('校园小助手')
  let userId
  if (demoUser) userId = demoUser.id
  else {
    const result = db.prepare('INSERT INTO users (username, password_hash, bio) VALUES (?, ?, ?)')
      .run('校园小助手', bcrypt.hashSync('DemoPass123!', 10), '分享校园里的新鲜事 🌱')
    userId = result.lastInsertRowid
  }
  const insert = db.prepare('INSERT INTO posts (user_id, category, title, content) VALUES (?, ?, ?, ?)')
  insert.run(userId, '校园生活', '欢迎来到青柠校园社区！', '这里是校园社区演示帖。你可以注册自己的账号，发布动态、点赞和评论。祝你每天都有新发现！')
  insert.run(userId, '学习交流', '一起分享高效学习方法', '欢迎同学们交流笔记整理、时间管理和考试复习经验。请友善交流，互相帮助。')
  insert.run(userId, '社团活动', '校园社团招新季', '摄影、音乐、运动、编程……找到感兴趣的社团，认识更多志同道合的伙伴。')
}

app.disable('x-powered-by')
app.use(helmet({
  contentSecurityPolicy: false
}))
app.use(express.json({ limit: '30kb' }))
app.use(session({
  name: 'qingning.sid',
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: dataDir }),
  secret: process.env.SESSION_SECRET || 'change-this-dev-secret-before-deployment-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}))

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: '操作过于频繁，请稍后再试。' }
})

const categories = ['校园生活', '学习交流', '失物招领', '社团活动', '美食分享']
const getUserById = db.prepare('SELECT id, username, bio, created_at AS createdAt FROM users WHERE id = ?')
const publicUser = (id) => id ? getUserById.get(id) || null : null
const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: '请先登录后再操作。' })
  req.user = publicUser(req.session.userId)
  if (!req.user) {
    req.session.destroy(() => {})
    return res.status(401).json({ error: '登录状态已失效，请重新登录。' })
  }
  next()
}

app.get('/api/health', (req, res) => res.json({ ok: true }))
app.get('/api/me', (req, res) => res.json({ user: publicUser(req.session.userId) }))

app.post('/api/register', authLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim()
  const password = String(req.body.password || '')
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_]{2,20}$/.test(username)) {
    return res.status(400).json({ error: '用户名需为 2–20 位中文、字母、数字或下划线。' })
  }
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: '密码长度需为 8–72 个字符。' })
  }
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: '这个用户名已被注册，请换一个。' })
  }
  try {
    const hash = await bcrypt.hash(password, 12)
    const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash)
    req.session.userId = Number(result.lastInsertRowid)
    res.status(201).json({ user: publicUser(req.session.userId) })
  } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: '用户名已存在。' })
    res.status(500).json({ error: '注册失败，请稍后重试。' })
  }
})

app.post('/api/login', authLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim()
  const password = String(req.body.password || '')
  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username)
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: '用户名或密码不正确。' })
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: '登录暂时不可用，请重试。' })
    req.session.userId = user.id
    res.json({ user: publicUser(user.id) })
  })
})

app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: '退出登录失败。' })
    res.clearCookie('qingning.sid', { httpOnly: true, sameSite: 'lax', secure: isProduction })
    res.json({ ok: true })
  })
})

app.patch('/api/me', requireAuth, (req, res) => {
  const bio = String(req.body.bio || '').trim().slice(0, 160)
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, req.user.id)
  res.json({ user: publicUser(req.user.id) })
})

app.get('/api/posts', (req, res) => {
  const category = String(req.query.category || '').trim()
  const q = String(req.query.q || '').trim().slice(0, 100)
  let sql = `
    SELECT p.id, p.user_id AS userId, p.category, p.title, p.content,
      p.created_at AS createdAt, u.username,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likeCount,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS commentCount,
      ${req.session.userId ? `EXISTS(SELECT 1 FROM likes ml WHERE ml.post_id = p.id AND ml.user_id = ${Number(req.session.userId)})` : '0'} AS liked
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE 1 = 1`
  const params = []
  if (categories.includes(category)) { sql += ' AND p.category = ?'; params.push(category) }
  if (q) {
    sql += ' AND (p.title LIKE ? OR p.content LIKE ? OR u.username LIKE ?)'
    params.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }
  sql += ' ORDER BY p.id DESC LIMIT 100'
  res.json({ posts: db.prepare(sql).all(...params) })
})

app.post('/api/posts', requireAuth, (req, res) => {
  const category = String(req.body.category || '')
  const title = String(req.body.title || '').trim()
  const content = String(req.body.content || '').trim()
  if (!categories.includes(category)) return res.status(400).json({ error: '请选择有效的帖子分类。' })
  if (title.length < 2 || title.length > 80) return res.status(400).json({ error: '标题需为 2–80 个字符。' })
  if (content.length < 2 || content.length > 5000) return res.status(400).json({ error: '正文需为 2–5000 个字符。' })
  const result = db.prepare('INSERT INTO posts (user_id, category, title, content) VALUES (?, ?, ?, ?)')
    .run(req.user.id, category, title, content)
  res.status(201).json({ id: Number(result.lastInsertRowid) })
})

app.delete('/api/posts/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(id)
  if (!post) return res.status(404).json({ error: '帖子不存在。' })
  if (post.user_id !== req.user.id) return res.status(403).json({ error: '只能删除自己发布的帖子。' })
  db.prepare('DELETE FROM posts WHERE id = ?').run(id)
  res.json({ ok: true })
})

app.post('/api/posts/:id/like', requireAuth, (req, res) => {
  const postId = Number(req.params.id)
  if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(postId)) {
    return res.status(404).json({ error: '帖子不存在。' })
  }
  const existing = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(req.user.id, postId)
  if (existing) db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.user.id, postId)
  else db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?, ?)').run(req.user.id, postId)
  const likeCount = db.prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?').get(postId).n
  res.json({ liked: !existing, likeCount })
})

app.get('/api/posts/:id/comments', (req, res) => {
  const postId = Number(req.params.id)
  if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(postId)) return res.status(404).json({ error: '帖子不存在。' })
  const comments = db.prepare(`
    SELECT c.id, c.content, c.created_at AS createdAt, u.username, c.user_id AS userId
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.post_id = ? ORDER BY c.id ASC LIMIT 200
  `).all(postId)
  res.json({ comments })
})

app.post('/api/posts/:id/comments', requireAuth, (req, res) => {
  const postId = Number(req.params.id)
  const content = String(req.body.content || '').trim()
  if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(postId)) return res.status(404).json({ error: '帖子不存在。' })
  if (content.length < 1 || content.length > 1000) return res.status(400).json({ error: '评论需为 1–1000 个字符。' })
  const result = db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)').run(postId, req.user.id, content)
  res.status(201).json({ id: Number(result.lastInsertRowid) })
})

app.delete('/api/comments/:id', requireAuth, (req, res) => {
  const comment = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(Number(req.params.id))
  if (!comment) return res.status(404).json({ error: '评论不存在。' })
  if (comment.user_id !== req.user.id) return res.status(403).json({ error: '只能删除自己的评论。' })
  db.prepare('DELETE FROM comments WHERE id = ?').run(Number(req.params.id))
  res.json({ ok: true })
})

if (isProduction) {
  const dist = path.join(__dirname, '..', 'client', 'dist')
  app.use(express.static(dist))
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')))
} else {
  app.get('/', (req, res) => res.status(200).send('青柠校园 API 已运行。开发环境请打开 http://127.0.0.1:5173'))
}

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: '服务器发生错误，请稍后重试。' })
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`青柠校园 API 已启动：http://127.0.0.1:${PORT}`)
})
