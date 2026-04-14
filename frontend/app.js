const postList = document.getElementById('postList');
const chatList = document.getElementById('chatList');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayBody = document.getElementById('overlayBody');
const backBtn = document.getElementById('backBtn');
const viewCount = document.getElementById('viewCount');
const likeCount = document.getElementById('likeCount');
const dislikeCount = document.getElementById('dislikeCount');
const commentCount = document.getElementById('commentCount');
const subCount = document.getElementById('subCount');
const moneyCount = document.getElementById('moneyCount');
const liveTitle = document.getElementById('liveTitle');
const liveMeta = document.getElementById('liveMeta');
const clipsList = document.getElementById('clipsList');
const effectLayer = document.getElementById('effectLayer');

const posts = [];
const chatFeed = [];
function formatTime() {
  const now = new Date();
  return now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function formatRange(startIso, endIso) {
  if (!startIso || !endIso) return formatTime();
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return formatTime();
  const startText = start.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const endText = end.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return `${startText}–${endText}`;
}

function formatDate() {
  const now = new Date();
  return now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

function formatDayLabel(date) {
  return date.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
}

const GODLIFE_KEYWORDS = ['코딩', '운동', '독서', '공부', '작업', '개발', '루틴', '산책', '수영', '헬스', '스트레칭'];
const LAZY_KEYWORDS = ['야식', '늦잠', '게임', '무기력', '눕', '멍', '침대', '넷플', '피곤'];

function classifyPost(text) {
  const content = (text || '').toLowerCase();
  const isGod = GODLIFE_KEYWORDS.some((k) => content.includes(k));
  const isLazy = LAZY_KEYWORDS.some((k) => content.includes(k));
  if (isGod && !isLazy) return 'GODLIFE';
  if (isLazy && !isGod) return 'LAZY';
  return 'NEUTRAL';
}

function extractTags(text) {
  const tags = [];
  GODLIFE_KEYWORDS.forEach((k) => {
    if (text.includes(k)) tags.push(k);
  });
  LAZY_KEYWORDS.forEach((k) => {
    if (text.includes(k)) tags.push(k);
  });
  return tags.slice(0, 3);
}

function renderChat() {
  if (!chatList) return;
  chatList.innerHTML = '';
  if (chatFeed.length === 0) {
    chatList.innerHTML = '<div class="chat-empty">첫 로그가 올라오면 채팅이 흐릅니다.</div>';
    return;
  }

  chatFeed.forEach((chat) => {
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.innerHTML = `
      <div class="chat-author">${chat.author}</div>
      <div class="chat-content">${chat.content}</div>
      <div class="chat-time">${chat.time}</div>
    `;
    chatList.appendChild(item);
  });
}

function getTotalMessages() {
  return posts.reduce((sum, p) => sum + (p.messageCount || 0), 0);
}

function updateStats() {
  const totalMessages = getTotalMessages();
  const godlifeEvents = posts.filter((p) => p.mood === 'GODLIFE').length;
  const views = totalMessages * 37 + godlifeEvents * 120;
  const likes = Math.max(0, Math.floor(views * 0.08));
  const dislikes = Math.max(0, Math.floor(views * 0.01));
  const comments = Math.max(0, chatFeed.length);

  let subs = Math.floor(totalMessages / 4);
  let money = totalMessages * 500 + godlifeEvents * 1500;

  const viralEvents = posts.filter((p) => p.mood === 'GODLIFE' && p.messageCount >= 5);
  if (viralEvents.length > 0) {
    subs += viralEvents.length * 18;
    money += viralEvents.length * 20000;
  }

  if (viewCount) viewCount.textContent = views.toLocaleString();
  if (likeCount) likeCount.textContent = likes.toLocaleString();
  if (dislikeCount) dislikeCount.textContent = dislikes.toLocaleString();
  if (commentCount) commentCount.textContent = comments.toLocaleString();
  if (subCount) subCount.textContent = subs.toLocaleString();
  if (moneyCount) moneyCount.textContent = `₩${money.toLocaleString()}`;

  if (liveMeta) {
    liveMeta.textContent = `업로드 ${totalMessages}개 · 시청 ${views.toLocaleString()}회`;
  }

  if (liveTitle) {
    const latest = posts[0];
    liveTitle.textContent = latest ? `${latest.dayLabel} 라이브 다시보기` : '산뜻한 브이로그 데이 로그';
  }
}

function triggerSoftEffects(intensity = 1, jackpot = false) {
  if (!effectLayer) return;
  document.body.classList.add('effect-glow');

  const petalCount = jackpot ? 24 : 8 + intensity * 4;
  const sparkleCount = jackpot ? 14 : 4 + intensity * 2;

  const petals = Array.from({ length: petalCount }).map(() => {
    const petal = document.createElement('div');
    petal.className = 'petal';
    petal.style.left = `${Math.random() * 100}%`;
    petal.style.top = `${-10 - Math.random() * 30}px`;
    petal.style.animationDelay = `${Math.random() * 0.4}s`;
    return petal;
  });

  const sparkles = Array.from({ length: sparkleCount }).map(() => {
    const sparkle = document.createElement('div');
    sparkle.className = 'sparkle';
    sparkle.style.left = `${10 + Math.random() * 80}%`;
    sparkle.style.top = `${10 + Math.random() * 60}%`;
    sparkle.style.animationDelay = `${Math.random() * 0.2}s`;
    return sparkle;
  });

  [...petals, ...sparkles].forEach((node) => effectLayer.appendChild(node));

  setTimeout(() => {
    document.body.classList.remove('effect-glow');
    [...petals, ...sparkles].forEach((node) => node.remove());
  }, jackpot ? 2000 : 1600);
}

function renderList() {
  postList.innerHTML = '';
  if (posts.length === 0) {
    postList.innerHTML = '<div class="empty">아직 글이 없습니다. 텔레그램으로 첫 일상을 보내보세요.</div>';
    return;
  }

  let lastDayKey = '';
  posts.forEach((post) => {
    if (post.dayKey && post.dayKey !== lastDayKey) {
      lastDayKey = post.dayKey;
      const dayRow = document.createElement('div');
      dayRow.className = 'card';
      dayRow.innerHTML = `
        <div class="card-title">${post.dayLabel} 라이브 다시보기</div>
        <div class="card-content">하루 기록이 하나의 라이브로 남습니다.</div>
      `;
      postList.appendChild(dayRow);
    }
    const card = document.createElement('div');
    card.className = 'card';
    if (post.isNew) {
      card.classList.add('new');
      post.isNew = false;
    }

    const chipClass = post.mood === 'GODLIFE' ? 'godlife' : post.mood === 'LAZY' ? 'lazy' : 'neutral';
    const moodLabel = post.mood === 'GODLIFE' ? '갓생' : post.mood === 'LAZY' ? '나태' : '일상';
    const chipTags = post.tags.map((tag) => `<span class="chip">${tag}</span>`).join('');
    card.innerHTML = `
      <div class="card-title">${post.title}</div>
      <div class="card-meta">
        <span>${post.author}</span>
        <span>${post.timeRange}</span>
      </div>
      <div class="card-chips">
        <span class="chip ${chipClass}">${moodLabel}</span>
        <span class="chip">세션 ${post.messageCount}개</span>
        ${post.isClip ? '<span class="chip godlife">레전드 클립</span>' : ''}
        ${chipTags}
      </div>
      <div class="card-content">${post.preview}</div>
    `;

    card.addEventListener('click', () => openOverlay(post));
    postList.appendChild(card);
  });
}

function openOverlay(post) {
  overlayTitle.textContent = post.title;
  overlayBody.innerHTML = `
    <div class="post-body">
      <h2>${post.title}</h2>
      <p>${post.content}</p>
    </div>
    <div class="comments">
      ${post.items.map((item) => `
        <div class="comment">
          <div class="author">${item.author || '익명'}</div>
          <div class="content">${item.content || ''}</div>
        </div>
      `).join('')}
    </div>
  `;
  overlay.classList.add('open');
  history.pushState({ overlay: true }, '');
}

function closeOverlay() {
  overlay.classList.remove('open');
}

backBtn.addEventListener('click', () => {
  if (history.state && history.state.overlay) {
    history.back();
  } else {
    closeOverlay();
  }
});

window.addEventListener('popstate', (event) => {
  if (!event.state || !event.state.overlay) {
    closeOverlay();
  }
});

let touchStartX = 0;
let touchStartY = 0;

overlay.addEventListener('touchstart', (event) => {
  const touch = event.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
});

overlay.addEventListener('touchmove', (event) => {
  const touch = event.touches[0];
  const deltaX = touch.clientX - touchStartX;
  const deltaY = Math.abs(touch.clientY - touchStartY);
  if (deltaX < -70 && deltaY < 40) {
    history.back();
  }
});

function rebuildChatFeed() {
  chatFeed.length = 0;
  posts.forEach((event) => {
    event.items.forEach((item) => {
      const comments = Array.isArray(item.comments) ? item.comments : [];
      comments.slice(0, 2).forEach((c) => {
        chatFeed.push({
          author: c.author || '익명',
          content: c.content || '',
          time: event.time,
        });
      });
    });
  });
  chatFeed.reverse();
  chatFeed.splice(30);
}

function addPosts(incoming) {
  if (!incoming || !Array.isArray(incoming.posts)) return;

  const combinedText = incoming.posts.map((p) => p.content || '').join(' ');
  const mood = incoming.mood || classifyPost(combinedText);
  const tags = extractTags(combinedText);
  const eventId = incoming.event_id || crypto.randomUUID();
  const existingIndex = posts.findIndex((p) => p.id === eventId);
  const previousCount = existingIndex === -1 ? 0 : (posts[existingIndex].messageCount || 0);

  const title = incoming.event_title || incoming.posts[0]?.title || '무제';
  const author = incoming.posts[0]?.author || '익명';
  const preview = combinedText.slice(0, 90) + (combinedText.length > 90 ? '...' : '');
  const messageCount = incoming.message_count || incoming.posts.length;
  const timeRange = formatRange(incoming.event_start, incoming.event_end);
  const eventStart = incoming.event_start ? new Date(incoming.event_start) : new Date();
  const dayKey = eventStart.toISOString().slice(0, 10);
  const dayLabel = formatDayLabel(eventStart);
  const isClip = mood === 'GODLIFE' && messageCount >= 4;

  const event = {
    id: eventId,
    title,
    author,
    content: combinedText,
    comments: incoming.posts.flatMap((p) => p.comments || []),
    preview,
    time: formatTime(),
    timeRange,
    isNew: existingIndex === -1,
    mood,
    tags,
    items: incoming.posts,
    messageCount,
    dayKey,
    dayLabel,
    isClip,
  };

  if (existingIndex === -1) {
    posts.unshift(event);
  } else {
    posts[existingIndex] = event;
  }

  rebuildChatFeed();
  renderList();
  renderChat();
  updateStats();
  updateClips();
  const intensity = mood === 'GODLIFE' ? 2 : mood === 'LAZY' ? 1 : 1;
  const jackpot = mood === 'GODLIFE' && Math.random() < 0.1;
  triggerSoftEffects(intensity, jackpot);
}

function updateClips() {
  if (!clipsList) return;
  clipsList.innerHTML = '';
  const clips = posts.filter((p) => p.isClip).slice(0, 6);
  if (clips.length === 0) {
    clipsList.innerHTML = '<div class="clip-empty">아직 클립이 없습니다.</div>';
    return;
  }
  clips.forEach((clip) => {
    const card = document.createElement('div');
    card.className = 'clip-card';
    card.innerHTML = `
      <div class="clip-title">${clip.title}</div>
      <div class="clip-meta">${clip.timeRange} · ${clip.messageCount} 로그</div>
    `;
    clipsList.appendChild(card);
  });
}

async function loadSavedPosts() {
  try {
    const res = await fetch('/posts');
    if (res.ok) {
      const savedPosts = await res.json();
      savedPosts.reverse().forEach((data) => {
        addPosts(data);
      });
    }
  } catch (err) {
    console.error('Failed to load saved posts', err);
  }
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${location.host}/ws`);

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'new_posts') {
        addPosts(payload.data);
      }
    } catch (err) {
      console.error('WS parse error', err);
    }
  };

  ws.onclose = () => {
    setTimeout(connect, 1500);
  };

  ws.onerror = () => {
    ws.close();
  };
}

loadSavedPosts();
connect();
updateStats();
updateClips();
renderChat();
