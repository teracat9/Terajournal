const postList = document.getElementById('postList');
const chatList = document.getElementById('chatList');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayBody = document.getElementById('overlayBody');
const backBtn = document.getElementById('backBtn');
const statExp = document.getElementById('statExp');
const statCoins = document.getElementById('statCoins');
const statCombo = document.getElementById('statCombo');
const statExpDelta = document.getElementById('statExpDelta');
const statCoinsDelta = document.getElementById('statCoinsDelta');
const comboFill = document.getElementById('comboFill');
const effectLayer = document.getElementById('effectLayer');

const posts = [];
const chatFeed = [];
const summaryState = {
  title: '오늘의 브이로그 요약',
  lines: [],
};

function formatTime() {
  const now = new Date();
  return now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate() {
  const now = new Date();
  return now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
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

function updateStats(newPostsCount, newMessageCount) {
  const totalMessages = getTotalMessages();
  const expValue = totalMessages * 30;
  const coinValue = totalMessages * 8;
  const comboValue = Math.min(posts.filter((p) => p.mood === 'GODLIFE').length, 7);

  if (statExp) statExp.textContent = expValue.toLocaleString();
  if (statCoins) statCoins.textContent = coinValue.toLocaleString();
  if (statCombo) statCombo.textContent = `${comboValue}일`;

  if (statExpDelta) statExpDelta.textContent = `+${(newMessageCount * 30).toLocaleString()}`;
  if (statCoinsDelta) statCoinsDelta.textContent = `+${(newMessageCount * 8).toLocaleString()}`;

  if (comboFill) {
    const percent = Math.min(100, comboValue * 14);
    comboFill.style.width = `${percent}%`;
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

  if (summaryState.lines.length > 0) {
    const summaryCard = document.createElement('div');
    summaryCard.className = 'summary-card';
    summaryCard.innerHTML = `
      <div class="summary-title">${summaryState.title} · ${formatDate()}</div>
      <div class="summary-lines">
        ${summaryState.lines.map((line) => `<div>${line}</div>`).join('')}
      </div>
    `;
    postList.appendChild(summaryCard);
  }

  posts.forEach((post) => {
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
        <span>${post.time}</span>
      </div>
      <div class="card-chips">
        <span class="chip ${chipClass}">${moodLabel}</span>
        <span class="chip">세션 ${post.messageCount}개</span>
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
  const mood = classifyPost(combinedText);
  const tags = extractTags(combinedText);
  const eventId = incoming.event_id || crypto.randomUUID();
  const existingIndex = posts.findIndex((p) => p.id === eventId);
  const previousCount = existingIndex === -1 ? 0 : (posts[existingIndex].messageCount || 0);

  const title = incoming.posts[0]?.title || '무제';
  const author = incoming.posts[0]?.author || '익명';
  const preview = combinedText.slice(0, 90) + (combinedText.length > 90 ? '...' : '');
  const messageCount = incoming.message_count || incoming.posts.length;

  const event = {
    id: eventId,
    title,
    author,
    content: combinedText,
    comments: incoming.posts.flatMap((p) => p.comments || []),
    preview,
    time: formatTime(),
    isNew: existingIndex === -1,
    mood,
    tags,
    items: incoming.posts,
    messageCount,
  };

  if (existingIndex === -1) {
    posts.unshift(event);
  } else {
    posts[existingIndex] = event;
  }

  updateSummary();
  rebuildChatFeed();
  renderList();
  renderChat();
  const deltaMessages = Math.max(0, messageCount - previousCount);
  updateStats(1, deltaMessages);
  const intensity = mood === 'GODLIFE' ? 2 : mood === 'LAZY' ? 1 : 1;
  const jackpot = mood === 'GODLIFE' && Math.random() < 0.1;
  triggerSoftEffects(intensity, jackpot);
}

function updateSummary() {
  const godlifeTotal = posts.filter((p) => p.mood === 'GODLIFE').length;
  const lazyTotal = posts.filter((p) => p.mood === 'LAZY').length;
  const neutralTotal = posts.filter((p) => p.mood === 'NEUTRAL').length;

  summaryState.title = godlifeTotal >= lazyTotal
    ? '오늘의 작은 승리 기록'
    : '오늘의 브이로그 점검';

  summaryState.lines = [
    `갓생 로그 ${godlifeTotal}개 · 나태 로그 ${lazyTotal}개 · 일상 ${neutralTotal}개`,
    godlifeTotal > 0 ? '루틴이 이어지고 있어요. 내일도 가볍게 한 걸음.' : '쉬어가도 괜찮아요. 작은 루틴부터 다시 켜봅시다.',
    `업로드 ${getTotalMessages()}개가 타임라인에 기록됨`,
  ];
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
updateStats(0, 0);
renderChat();
