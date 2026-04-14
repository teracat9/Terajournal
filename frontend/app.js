const postList = document.getElementById('postList');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayBody = document.getElementById('overlayBody');
const backBtn = document.getElementById('backBtn');

const posts = [];

function formatTime() {
  const now = new Date();
  return now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function renderList() {
  postList.innerHTML = '';
  if (posts.length === 0) {
    postList.innerHTML = '<div class="empty">아직 글이 없습니다. 텔레그램으로 첫 일상을 보내보세요.</div>';
    return;
  }

  posts.forEach((post) => {
    const card = document.createElement('div');
    card.className = 'card';
    if (post.isNew) {
      card.classList.add('new');
      post.isNew = false;
    }

    card.innerHTML = `
      <div class="card-title">${post.title}</div>
      <div class="card-meta">
        <span>${post.author}</span>
        <span>${post.time}</span>
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
      ${post.comments.map((c) => `
        <div class="comment">
          <div class="author">${c.author}</div>
          <div class="content">${c.content}</div>
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

function addPosts(incoming) {
  if (!incoming || !Array.isArray(incoming.posts)) return;

  incoming.posts.forEach((p) => {
    const post = {
      id: crypto.randomUUID(),
      title: p.title || '무제',
      author: p.author || '익명',
      content: p.content || '',
      comments: Array.isArray(p.comments) ? p.comments : [],
      preview: (p.content || '').slice(0, 80) + (p.content && p.content.length > 80 ? '...' : ''),
      time: formatTime(),
      isNew: true,
    };
    posts.unshift(post);
  });

  renderList();
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

connect();
