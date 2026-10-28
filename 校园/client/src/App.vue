<script setup>
import { computed, onMounted, ref } from 'vue'

const user = ref(null)
const posts = ref([])
const category = ref('全部')
const query = ref('')
const mode = ref('login')
const showAuth = ref(false)
const showComposer = ref(false)
const busy = ref(false)
const message = ref('')
const error = ref('')
const authForm = ref({ username: '', password: '' })
const postForm = ref({ title: '', category: '校园生活', content: '' })
const profileBio = ref('')
const activeComments = ref(null)
const comments = ref([])
const commentDraft = ref('')

const categories = ['全部', '校园生活', '学习交流', '失物招领', '社团活动', '美食分享']
const filteredPosts = computed(() => posts.value)

function flash(text, isError = false) {
  message.value = isError ? '' : text
  error.value = isError ? text : ''
  setTimeout(() => { message.value = ''; error.value = '' }, 3500)
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  })
  const data = response.status === 204 ? {} : await response.json()
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试。')
  return data
}

async function loadMe() {
  try {
    const data = await api('/api/me')
    user.value = data.user
    profileBio.value = data.user?.bio || ''
  } catch { user.value = null }
}

async function loadPosts() {
  try {
    const params = new URLSearchParams()
    if (category.value !== '全部') params.set('category', category.value)
    if (query.value.trim()) params.set('q', query.value.trim())
    const data = await api('/api/posts?' + params.toString())
    posts.value = data.posts
  } catch (e) { flash(e.message, true) }
}

async function submitAuth() {
  if (busy.value) return
  busy.value = true
  try {
    const endpoint = mode.value === 'login' ? '/api/login' : '/api/register'
    const data = await api(endpoint, { method: 'POST', body: JSON.stringify(authForm.value) })
    user.value = data.user
    profileBio.value = data.user.bio || ''
    showAuth.value = false
    authForm.value = { username: '', password: '' }
    flash(mode.value === 'login' ? '登录成功，欢迎回来！' : '注册成功，欢迎加入青柠校园！')
    await loadPosts()
  } catch (e) { flash(e.message, true) }
  finally { busy.value = false }
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST', body: '{}' })
    user.value = null
    activeComments.value = null
    flash('已安全退出登录。')
    await loadPosts()
  } catch (e) { flash(e.message, true) }
}

async function publishPost() {
  try {
    await api('/api/posts', { method: 'POST', body: JSON.stringify(postForm.value) })
    postForm.value = { title: '', category: '校园生活', content: '' }
    showComposer.value = false
    category.value = '全部'
    query.value = ''
    await loadPosts()
    flash('动态发布成功！')
  } catch (e) { flash(e.message, true) }
}

async function toggleLike(post) {
  if (!user.value) { showAuth.value = true; mode.value = 'login'; return }
  try {
    const data = await api(`/api/posts/${post.id}/like`, { method: 'POST', body: '{}' })
    post.liked = data.liked ? 1 : 0
    post.likeCount = data.likeCount
  } catch (e) { flash(e.message, true) }
}

async function deletePost(post) {
  if (!confirm('确定删除这条动态吗？此操作无法撤销。')) return
  try {
    await api(`/api/posts/${post.id}`, { method: 'DELETE' })
    await loadPosts()
    flash('帖子已删除。')
  } catch (e) { flash(e.message, true) }
}

async function openComments(post) {
  activeComments.value = post
  comments.value = []
  commentDraft.value = ''
  try {
    const data = await api(`/api/posts/${post.id}/comments`)
    comments.value = data.comments
  } catch (e) { flash(e.message, true) }
}

async function addComment() {
  if (!activeComments.value) return
  try {
    await api(`/api/posts/${activeComments.value.id}/comments`, {
      method: 'POST', body: JSON.stringify({ content: commentDraft.value })
    })
    commentDraft.value = ''
    await openComments(activeComments.value)
    await loadPosts()
    flash('评论已发布。')
  } catch (e) { flash(e.message, true) }
}

async function deleteComment(comment) {
  if (!confirm('确定删除这条评论吗？')) return
  try {
    await api(`/api/comments/${comment.id}`, { method: 'DELETE' })
    await openComments(activeComments.value)
    await loadPosts()
  } catch (e) { flash(e.message, true) }
}

async function saveProfile() {
  try {
    const data = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ bio: profileBio.value }) })
    user.value = data.user
    flash('个人简介已保存。')
  } catch (e) { flash(e.message, true) }
}

function timeLabel(value) {
  if (!value) return ''
  return value.replace('T', ' ').replace('Z', '').slice(0, 16)
}

onMounted(async () => {
  await loadMe()
  await loadPosts()
})
</script>

<template>
  <div class="page-shell">
    <header class="topbar">
      <a class="brand" href="#" aria-label="青柠校园首页">
        <span class="brand-mark">🍃</span>
        <span>青柠<span class="brand-light">校园</span><small>CAMPUS COMMUNITY</small></span>
      </a>
      <nav class="nav">
        <a href="#home" class="nav-active">首页</a>
        <a href="#community">校园社区</a>
        <a href="#topics">热门话题</a>
      </nav>
      <div class="top-actions">
        <template v-if="user">
          <span class="hello">你好，{{ user.username }}</span>
          <button class="btn btn-outline btn-small" @click="logout">退出</button>
        </template>
        <template v-else>
          <button class="btn btn-outline btn-small" @click="mode='login';showAuth=true">登录</button>
          <button class="btn btn-primary btn-small" @click="mode='register';showAuth=true">加入社区</button>
        </template>
      </div>
    </header>

    <main>
      <section class="hero" id="home">
        <div class="hero-copy">
          <div class="eyebrow"><span class="pulse"></span> YOUR CAMPUS, YOUR STORIES</div>
          <h1>让校园生活<br><span>自然生长。</span></h1>
          <p>分享日常里的小美好，发现校园中的新鲜事。<br>在这里，遇见有趣的人，记录闪光的青春。</p>
          <div class="hero-actions">
            <button class="btn btn-primary" @click="user ? showComposer=true : (showAuth=true,mode='login')">✎ 发布校园动态</button>
            <a class="text-link" href="#community">逛逛社区 <span>↗</span></a>
          </div>
          <div class="hero-foot"><span>✦</span> 一起分享，一起成长</div>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <div class="sun"></div><div class="leaf leaf-one">✿</div><div class="leaf leaf-two">❋</div>
          <div class="floating-note note-one">☀ 今天也要开心</div>
          <div class="floating-note note-two">🌱 新故事正在发生</div>
          <div class="plant-pot"><div class="plant-stem"></div><div class="plant-leaf l1"></div><div class="plant-leaf l2"></div><div class="plant-leaf l3"></div><div class="pot"></div></div>
          <div class="hero-circle circle-one"></div><div class="hero-circle circle-two"></div>
        </div>
      </section>

      <section class="quick-stats">
        <div><span class="stat-icon">🌿</span><span><b>{{ posts.length }}</b><small>社区动态</small></span></div>
        <div><span class="stat-icon">💬</span><span><b>友善交流</b><small>每个声音都值得倾听</small></span></div>
        <div><span class="stat-icon">🌼</span><span><b>校园日常</b><small>把小事变成好故事</small></span></div>
      </section>

      <div class="content-grid">
        <section class="feed-panel" id="community">
          <div class="section-heading">
            <div><span class="section-kicker">CAMPUS FEED</span><h2>校园新鲜事 <span class="heading-dot">.</span></h2><p>看看同学们最近在分享什么</p></div>
            <button class="btn btn-primary" @click="user ? showComposer=!showComposer : (showAuth=true,mode='login')">＋ 发动态</button>
          </div>

          <form v-if="showComposer" class="composer" @submit.prevent="publishPost">
            <div class="composer-title">写下你的校园故事 <span>✦</span></div>
            <input v-model.trim="postForm.title" required minlength="2" maxlength="80" placeholder="给这条动态起个标题（2–80 字）" />
            <select v-model="postForm.category">
              <option v-for="c in categories.slice(1)" :key="c">{{ c }}</option>
            </select>
            <textarea v-model.trim="postForm.content" required minlength="2" maxlength="5000" placeholder="此刻有什么想分享的？"></textarea>
            <div class="composer-actions"><span>🌱 友善表达，让社区更温暖</span><button class="btn btn-primary" type="submit">发布动态</button></div>
          </form>

          <div class="feed-tools">
            <div class="category-list">
              <button v-for="c in categories" :key="c" :class="['category-pill', { selected: category===c }]" @click="category=c;loadPosts()">{{ c }}</button>
            </div>
            <form class="search-box" @submit.prevent="loadPosts"><span>⌕</span><input v-model="query" placeholder="搜索校园动态..." /><button type="submit">搜索</button></form>
          </div>

          <div v-if="filteredPosts.length" class="post-list">
            <article v-for="post in filteredPosts" :key="post.id" class="post-card">
              <div class="post-author-row">
                <div class="avatar">{{ (post.username || '同').slice(0,1) }}</div>
                <div class="author-details"><b>{{ post.username }}</b><small>{{ timeLabel(post.createdAt) }}</small></div>
                <span class="post-category">{{ post.category }}</span>
              </div>
              <h3>{{ post.title }}</h3>
              <p class="post-body">{{ post.content }}</p>
              <div class="post-footer">
                <button :class="['post-action', { liked: post.liked }]" @click="toggleLike(post)">{{ post.liked ? '♥' : '♡' }} <span>{{ post.likeCount }}</span> 点赞</button>
                <button class="post-action" @click="openComments(post)">☏ <span>{{ post.commentCount }}</span> 评论</button>
                <button v-if="user && user.id===post.userId" class="post-action delete-action" @click="deletePost(post)">删除</button>
              </div>
            </article>
          </div>
          <div v-else class="empty-state"><span>🌱</span><h3>这里暂时还没有动态</h3><p>换个分类看看，或者发布第一条校园故事。</p><button class="btn btn-outline" @click="user ? showComposer=true : (showAuth=true,mode='register')">分享第一条动态</button></div>
        </section>

        <aside class="sidebar">
          <section class="side-card profile-card">
            <div class="side-heading"><h3>我的小天地</h3><span>✿</span></div>
            <template v-if="user">
              <div class="profile-avatar">{{ user.username.slice(0,1) }}</div>
              <h4>{{ user.username }}</h4><p class="muted">青柠校园社区成员</p>
              <label class="field-label" for="bio">个人简介</label>
              <textarea id="bio" v-model="profileBio" maxlength="160" placeholder="写一句介绍自己吧..." class="bio-input"></textarea>
              <button class="btn btn-primary full-btn" @click="saveProfile">保存资料</button>
            </template>
            <template v-else>
              <div class="profile-avatar">🌱</div><h4>欢迎来到青柠校园</h4>
              <p class="muted">登录后发布动态、点赞和评论，和同学们一起交流。</p>
              <button class="btn btn-primary full-btn" @click="mode='register';showAuth=true">创建我的账号</button>
            </template>
          </section>

          <section class="side-card notice-card">
            <div class="side-heading"><h3>校园公告</h3><span>📌</span></div>
            <div class="notice-item"><span class="notice-mark">01</span><div><b>文明交流倡议</b><p>尊重彼此，让每一次讨论都有温度。</p></div></div>
            <div class="notice-item"><span class="notice-mark">02</span><div><b>社区使用小贴士</b><p>发帖前确认内容，不公开个人隐私。</p></div></div>
            <div class="notice-item"><span class="notice-mark">03</span><div><b>一起丰富校园生活</b><p>分享社团活动、学习经验与校园发现。</p></div></div>
          </section>

          <section class="side-card topics-card" id="topics">
            <div class="side-heading"><h3>大家在聊</h3><span>↗</span></div>
            <button @click="category='校园生活';loadPosts()"># 校园生活 <span>随手记录</span></button>
            <button @click="category='学习交流';loadPosts()"># 学习搭子 <span>共同进步</span></button>
            <button @click="category='美食分享';loadPosts()"># 食堂美食 <span>发现好味道</span></button>
            <button @click="category='社团活动';loadPosts()"># 社团活动 <span>找到同好</span></button>
          </section>
        </aside>
      </div>
    </main>

    <footer><div class="footer-brand">🍃 青柠校园</div><p>让每一次分享都有意义，让校园生活自然生长。</p><small>校园社区学习项目 · 请友善交流，保护个人隐私</small></footer>

    <div v-if="message || error" class="toast" :class="{ 'toast-error': error }">{{ error || message }}</div>

    <div v-if="showAuth" class="modal-backdrop" @click.self="showAuth=false">
      <section class="modal auth-modal">
        <button class="modal-close" aria-label="关闭" @click="showAuth=false">×</button>
        <div class="modal-emblem">🍃</div>
        <span class="section-kicker">WELCOME TO CAMPUS</span>
        <h2>{{ mode==='login' ? '欢迎回来' : '加入青柠校园' }}</h2>
        <p class="modal-subtitle">{{ mode==='login' ? '登录后继续你的校园故事。' : '创建账号，开始分享校园生活。' }}</p>
        <form @submit.prevent="submitAuth">
          <label for="username">用户名</label><input id="username" v-model.trim="authForm.username" required minlength="2" maxlength="20" autocomplete="username" placeholder="2–20 位中文、字母、数字或下划线" />
          <label for="password">密码</label><input id="password" v-model="authForm.password" type="password" required minlength="8" maxlength="72" :autocomplete="mode==='login' ? 'current-password' : 'new-password'" placeholder="至少 8 个字符" />
          <button class="btn btn-primary full-btn auth-submit" :disabled="busy">{{ busy ? '请稍候...' : (mode==='login' ? '登录' : '创建账号') }}</button>
        </form>
        <p class="switch-mode">{{ mode==='login' ? '还没有账号？' : '已经注册过了？' }} <button @click="mode=mode==='login'?'register':'login'">{{ mode==='login' ? '立即注册' : '返回登录' }}</button></p>
      </section>
    </div>

    <div v-if="activeComments" class="modal-backdrop" @click.self="activeComments=null">
      <section class="modal comments-modal">
        <button class="modal-close" aria-label="关闭" @click="activeComments=null">×</button>
        <span class="section-kicker">COMMUNITY VOICES</span><h2>评论与交流</h2><p class="comments-post-title">{{ activeComments.title }}</p>
        <div class="comments-list">
          <div v-for="c in comments" :key="c.id" class="comment-row"><div class="comment-avatar">{{ c.username.slice(0,1) }}</div><div class="comment-main"><b>{{ c.username }}</b><p>{{ c.content }}</p><small>{{ timeLabel(c.createdAt) }}</small></div><button v-if="user && user.id===c.userId" class="comment-delete" @click="deleteComment(c)">删除</button></div>
          <p v-if="!comments.length" class="muted comments-empty">还没有评论，来写下第一句友善的话吧。</p>
        </div>
        <form v-if="user" class="comment-form" @submit.prevent="addComment"><textarea v-model.trim="commentDraft" required maxlength="1000" placeholder="写下你的评论..." /><button class="btn btn-primary" type="submit">发送评论</button></form>
        <button v-else class="btn btn-primary full-btn" @click="activeComments=null;showAuth=true;mode='login'">登录后参与评论</button>
      </section>
    </div>
  </div>
</template>
