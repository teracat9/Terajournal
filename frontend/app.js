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
const levelValue = document.getElementById('levelValue');
const levelBar = document.getElementById('levelBar');
const levelMeta = document.getElementById('levelMeta');
const streakValue = document.getElementById('streakValue');
const comboValue = document.getElementById('comboValue');
const hypeMeta = document.getElementById('hypeMeta');
const missionLog = document.getElementById('missionLog');
const missionScore = document.getElementById('missionScore');
const missionStreak = document.getElementById('missionStreak');
const rewardTitle = document.getElementById('rewardTitle');
const rewardMeta = document.getElementById('rewardMeta');
const jackpotChance = document.getElementById('jackpotChance');

const posts = [];
const chatFeed = [];
const CHANNEL_STATE_SAVE_DELAY = 1200;

function createDefaultChannelState() {
  return {
    views: 0,
    likes: 0,
    dislikes: 0,
    subs: 0,
    money: 0,
    xp: 0,
    rewardedEventIds: [],
    lastTickAt: Date.now(),
  };
}

function sanitizeChannelState(rawState) {
  const base = createDefaultChannelState();
  const source = rawState && typeof rawState === 'object' ? rawState : {};
  const toNonNegativeInt = (v, fallback = 0) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.floor(n));
  };
  const rewarded = Array.isArray(source.rewardedEventIds)
    ? source.rewardedEventIds.map((x) => String(x)).slice(-800)
    : [];
  return {
    views: toNonNegativeInt(source.views, base.views),
    likes: toNonNegativeInt(source.likes, base.likes),
    dislikes: toNonNegativeInt(source.dislikes, base.dislikes),
    subs: toNonNegativeInt(source.subs, base.subs),
    money: toNonNegativeInt(source.money, base.money),
    xp: toNonNegativeInt(source.xp, base.xp),
    rewardedEventIds: rewarded,
    lastTickAt: toNonNegativeInt(source.lastTickAt, base.lastTickAt),
  };
}

function syncChannelState(rawState) {
  const saved = sanitizeChannelState(rawState);
  Object.assign(channelState, saved);
  rewardedEventIdSet.clear();
  saved.rewardedEventIds.forEach((id) => rewardedEventIdSet.add(id));
  return saved;
}

const channelState = createDefaultChannelState();
const rewardedEventIdSet = new Set();
let saveTimer = null;
let saveInFlight = false;
let saveQueued = false;

function snapshotChannelState() {
  return {
    ...channelState,
    rewardedEventIds: [...rewardedEventIdSet].slice(-800),
  };
}

async function saveChannelStateToServer() {
  if (saveInFlight) {
    saveQueued = true;
    return;
  }
  saveInFlight = true;
  try {
    const payload = snapshotChannelState();
    const res = await fetch('/channel-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      syncChannelState(await res.json());
    }
  } catch (err) {
    console.error('Failed to save channel state', err);
  } finally {
    saveInFlight = false;
    if (saveQueued) {
      saveQueued = false;
      saveChannelStateToServer();
    }
  }
}

function scheduleChannelStateSave(immediate = false) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (immediate) {
    saveChannelStateToServer();
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveChannelStateToServer();
  }, CHANNEL_STATE_SAVE_DELAY);
}

async function loadChannelStateFromServer() {
  try {
    const res = await fetch('/channel-state');
    if (!res.ok) return;
    syncChannelState(await res.json());
  } catch (err) {
    console.error('Failed to load channel state', err);
  }
}
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

function normalizeLifeScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function moodFromScore(score) {
  if (score >= 70) return 'GODLIFE';
  if (score <= 30) return 'LAZY';
  return 'NEUTRAL';
}

function compactText(value, limit = 60) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

function syncChapterNumbers() {
  const counters = new Map();
  posts.forEach((post) => {
    const key = post.dayKey || 'unknown';
    const next = (counters.get(key) || 0) + 1;
    counters.set(key, next);
    post.chapterNum = next;
  });
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

function parseDayKey(dayKey) {
  const [y, m, d] = String(dayKey || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function getStreakDays() {
  const dayKeys = [...new Set(posts.map((p) => p.dayKey).filter(Boolean))]
    .sort((a, b) => parseDayKey(b) - parseDayKey(a));
  if (dayKeys.length === 0) return 0;

  let streak = 1;
  let cursor = parseDayKey(dayKeys[0]);
  for (let i = 1; i < dayKeys.length; i += 1) {
    const next = parseDayKey(dayKeys[i]);
    if (!next) break;
    const expected = new Date(cursor);
    expected.setUTCDate(expected.getUTCDate() - 1);
    if (next.getTime() === expected.getTime()) {
      streak += 1;
      cursor = next;
    } else {
      break;
    }
  }
  return streak;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getAverageLifeScore() {
  if (posts.length === 0) return 50;
  return Math.round(posts.reduce((sum, p) => sum + (p.lifeScore || 50), 0) / posts.length);
}

function getQualityFactor() {
  const avgLifeScore = getAverageLifeScore();
  const streak = getStreakDays();
  return Math.max(0.25, Math.min(1.8, 0.3 + (avgLifeScore / 100) * 0.9 + streak * 0.06));
}

function applyPassiveGrowth() {
  const now = Date.now();
  const elapsedMs = now - (channelState.lastTickAt || now);
  if (elapsedMs < 1000) return;

  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  const qualityFactor = getQualityFactor();
  const baseHourlyViews = 8 + Math.sqrt(Math.max(0, channelState.subs)) * 3 + posts.length * 0.8;
  const passiveViews = Math.max(0, Math.floor(elapsedHours * baseHourlyViews * qualityFactor));

  if (passiveViews > 0) {
    const likeRate = 0.035 + qualityFactor * 0.02;
    const dislikeRate = Math.max(0.003, 0.016 - qualityFactor * 0.006);
    const subsRate = 0.0005 + qualityFactor * 0.0005;

    channelState.views += passiveViews;
    channelState.likes += Math.floor(passiveViews * likeRate);
    channelState.dislikes += Math.floor(passiveViews * dislikeRate);
    channelState.subs += Math.floor(passiveViews * subsRate);
    channelState.money += Math.floor(passiveViews * (1.2 + qualityFactor * 1.4));
    channelState.xp += Math.floor((passiveViews / 20) * Math.max(0.6, qualityFactor * 0.8));
    scheduleChannelStateSave();
  }

  channelState.lastTickAt = now;
}

function applyContentReward(event, isNewEvent) {
  if (!isNewEvent || !event?.id || rewardedEventIdSet.has(event.id)) return;

  const score = normalizeLifeScore(event.lifeScore);
  let viewsGain = 0;
  let likesGain = 0;
  let dislikesGain = 0;
  let subsGain = 0;
  let moneyGain = 0;
  let xpGain = 0;

  if (score >= 70) {
    viewsGain = 60 + (score - 70) * 6;
    likesGain = Math.floor(viewsGain * (0.08 + (score - 70) / 400));
    dislikesGain = Math.floor(viewsGain * 0.004);
    subsGain = Math.max(1, Math.floor((score - 65) / 10)) + (score >= 85 ? 2 : 0);
    moneyGain = 1200 + score * 42;
    xpGain = 30 + Math.floor((score - 65) * 1.5);
  } else if (score <= 30) {
    dislikesGain = 1 + Math.floor((30 - score) / 8);
    xpGain = 3;
  } else {
    xpGain = 6 + Math.floor((score - 40) / 6);
  }

  channelState.views += viewsGain;
  channelState.likes += likesGain;
  channelState.dislikes += dislikesGain;
  channelState.subs = Math.max(0, channelState.subs + subsGain);
  channelState.money += moneyGain;
  channelState.xp += Math.max(0, xpGain);
  channelState.lastTickAt = Date.now();

  rewardedEventIdSet.add(event.id);
  scheduleChannelStateSave(true);
}

function updateGameSystems(metrics) {
  const comments = metrics.comments;
  const views = metrics.views;
  const subs = metrics.subs;

  const avgLifeScore = getAverageLifeScore();
  const qualityPosts = posts.filter((p) => p.lifeScore >= 70).length;
  const streak = getStreakDays();
  const combo = (1 + (streak * 0.08) + ((avgLifeScore - 50) / 150));
  const comboText = `x${combo.toFixed(1)}`;

  const xp = Math.max(0, Math.floor(channelState.xp));
  const level = Math.floor(xp / 120) + 1;
  const currentLevelBase = (level - 1) * 120;
  const currentXp = xp - currentLevelBase;
  const nextXp = level * 120;
  const levelProgress = clampPercent((currentXp / 120) * 100);

  const hype = clampPercent((views / 1200) + ((avgLifeScore - 40) * 1.2) + (comments * 0.8) + (streak * 8));
  const missionLogPct = clampPercent((qualityPosts / 5) * 100);
  const missionScorePct = clampPercent((avgLifeScore / 70) * 100);
  const missionStreakPct = clampPercent((streak / 3) * 100);

  const rewardMilestones = [50, 100, 250, 500, 1000, 2500, 5000];
  const nextMilestone = rewardMilestones.find((m) => subs < m) || (Math.ceil(subs / 5000) * 5000);
  const remain = Math.max(0, nextMilestone - subs);
  const jackpot = clampPercent((hype * 0.45) + (avgLifeScore * 0.15));

  if (levelValue) levelValue.textContent = `Lv.${level}`;
  if (levelMeta) levelMeta.textContent = `${currentXp.toLocaleString()} / ${nextXp.toLocaleString()} XP`;
  if (levelBar) levelBar.style.width = `${levelProgress}%`;
  if (streakValue) streakValue.textContent = streak.toLocaleString();
  if (comboValue) comboValue.textContent = comboText;
  if (hypeMeta) hypeMeta.textContent = `하이프 ${hype}%`;
  if (missionLog) missionLog.textContent = `${missionLogPct}%`;
  if (missionScore) missionScore.textContent = `${missionScorePct}%`;
  if (missionStreak) missionStreak.textContent = `${missionStreakPct}%`;
  if (rewardTitle) rewardTitle.textContent = remain === 0 ? '보상 달성 가능' : '신규 뱃지 해금';
  if (rewardMeta) rewardMeta.textContent = `구독자 ${nextMilestone.toLocaleString()}명까지 ${remain.toLocaleString()}명 남음`;
  if (jackpotChance) jackpotChance.textContent = `잭팟 확률 ${jackpot}%`;
}

function updateStats() {
  applyPassiveGrowth();

  const totalPosts = posts.length;
  const views = Math.max(0, Math.floor(channelState.views));
  const likes = Math.max(0, Math.floor(channelState.likes));
  const dislikes = Math.max(0, Math.floor(channelState.dislikes));
  const comments = Math.max(0, chatFeed.length);
  const subs = Math.max(0, Math.floor(channelState.subs));
  const money = Math.max(0, Math.floor(channelState.money));

  if (viewCount) viewCount.textContent = views.toLocaleString();
  if (likeCount) likeCount.textContent = likes.toLocaleString();
  if (dislikeCount) dislikeCount.textContent = dislikes.toLocaleString();
  if (commentCount) commentCount.textContent = comments.toLocaleString();
  if (subCount) subCount.textContent = subs.toLocaleString();
  if (moneyCount) moneyCount.textContent = `₩${money.toLocaleString()}`;

  if (liveMeta) {
    liveMeta.textContent = `업로드 ${totalPosts}개 · 시청 ${views.toLocaleString()}회`;
  }

  if (liveTitle) {
    const latest = posts[0];
    liveTitle.textContent = latest ? `${latest.dayLabel} 챕터 다시보기` : '산뜻한 브이로그 챕터 로그';
  }
  updateGameSystems({
    views,
    likes,
    comments,
    subs,
    money,
  });
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
      dayRow.className = 'chapter-day';
      dayRow.innerHTML = `
        <div class="chapter-day-label">${post.dayLabel}</div>
        <div class="chapter-day-sub">하루 기록이 하나의 라이브 챕터로 남습니다.</div>
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
    const moodLabel = post.mood === 'GODLIFE' ? '상승' : post.mood === 'LAZY' ? '하강' : '균형';
    card.innerHTML = `
      <div class="chapter-layout">
        <div class="chapter-thumb ${chipClass}">
          <span class="chapter-num">CH.${post.chapterNum || 1}</span>
          <span class="chapter-time">${post.messageCount} Logs</span>
        </div>
        <div class="chapter-info">
          <div class="card-title">${post.title}</div>
          <div class="card-meta">
            <span>${post.author}</span>
            <span>${post.timeRange}</span>
          </div>
          <div class="card-chips">
            <span class="chip-inline ${chipClass}">${post.lifeScore}점 ${moodLabel}</span>
            <span class="chip-inline">세션 ${post.messageCount}개</span>
            ${post.lifeReason ? `<span class="chip-inline muted">${post.lifeReason}</span>` : ''}
            ${post.isClip ? '<span class="chip-inline gold">레전드 클립</span>' : ''}
          </div>
          <div class="card-content">${post.preview}</div>
        </div>
      </div>
    `;

    card.addEventListener('click', () => openOverlay(post));
    postList.appendChild(card);
  });
}

function openOverlay(post) {
  overlayTitle.textContent = post.title;
  overlayBody.innerHTML = `
    ${post.items.map((item) => `
      <div class="post-body">
        <h2>${item.title || post.title}</h2>
        <div class="card-meta">
          <span>${item.author || '익명'}</span>
          <span>${post.timeRange}</span>
        </div>
        <p>${item.content || ''}</p>
      </div>
    `).join('')}
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
    const source = Array.isArray(event.liveComments) && event.liveComments.length > 0
      ? event.liveComments
      : event.items.flatMap((item) => Array.isArray(item.comments) ? item.comments : []);
    source.slice(-20).forEach((c) => {
      chatFeed.push({
        author: c.author || '익명',
        content: c.content || '',
        time: event.time,
      });
    });
  });
  chatFeed.reverse();
  chatFeed.splice(30);
}

function addPosts(incoming, options = {}) {
  if (!incoming || !Array.isArray(incoming.posts)) return;
  const rewardEligible = options.rewardEligible !== false;

  const latestPostContent = incoming.posts[incoming.posts.length - 1]?.content || incoming.posts[0]?.content || '';
  const previewSource = incoming.user_summary || latestPostContent || incoming.posts[0]?.content || '';
  const preview = compactText(previewSource, 52);
  const lifeScore = normalizeLifeScore(incoming.life_score);
  const mood = incoming.mood || moodFromScore(lifeScore);
  const eventId = incoming.event_id || crypto.randomUUID();
  const existingIndex = posts.findIndex((p) => p.id === eventId);

  const title = incoming.event_title || incoming.posts[0]?.title || '무제';
  const author = incoming.posts[0]?.author || '익명';
  const messageCount = incoming.message_count || incoming.posts.length;
  const timeRange = formatRange(incoming.event_start, incoming.event_end);
  const eventStart = incoming.event_start ? new Date(incoming.event_start) : new Date();
  const dayKey = eventStart.toISOString().slice(0, 10);
  const dayLabel = formatDayLabel(eventStart);
  const isClip = lifeScore >= 75 && messageCount >= 4;
  const isSystemEvent = author === '시스템';

  const event = {
    id: eventId,
    title,
    author,
    content: preview,
    liveComments: Array.isArray(incoming.live_comments)
      ? incoming.live_comments.filter((c) => c && c.content)
      : [],
    preview,
    time: formatTime(),
    timeRange,
    isNew: existingIndex === -1,
    mood,
    lifeScore,
    lifeReason: incoming.life_reason || '',
    items: incoming.posts,
    messageCount,
    dayKey,
    dayLabel,
    isClip,
  };

  const serverState = incoming.channel_state;
  if (serverState) {
    syncChannelState(serverState);
  }

  if (existingIndex === -1) {
    posts.unshift(event);
  } else {
    posts[existingIndex] = event;
  }

  const rewardAlreadyApplied = Boolean(incoming.reward_applied) || Boolean(serverState);
  applyContentReward(event, rewardEligible && existingIndex === -1 && !rewardAlreadyApplied && !isSystemEvent);
  syncChapterNumbers();
  rebuildChatFeed();
  renderList();
  renderChat();
  updateStats();
  updateClips();
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
        addPosts(data, { rewardEligible: false });
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

window.addEventListener('beforeunload', () => {
  scheduleChannelStateSave(true);
});

async function initializeApp() {
  await loadChannelStateFromServer();
  await loadSavedPosts();
  connect();
  updateStats();
  updateClips();
  renderChat();
  setInterval(updateStats, 30000);
}

initializeApp();
