// ===== 설정 (카테고리 추가·삭제는 여기서) =====
const CONFIG = {
  dataUrl: 'products.json',
  kakaoUrl: 'http://pf.kakao.com/_TcxlBX/chat',
  cat1: ['all', 'clothes-women', 'clothes-men'],
  cat2: ['all', 'top', 'bottom', 'outer', 'shoes', 'etc'],
  pageSize: 60, // 한 번에 그리는 상품 수 (스크롤 시 추가)
  newCount: 18, // 신상 가로줄 상품 수
  newPool: 50,  // 신상 후보: 최근 등록 50개 중 무작위 선택
};

const $ = (s) => document.querySelector(s);
const state = { base: '', items: [], view: [], shown: 0, cat1: 'all', cat2: 'all', q: '', sort: 'new' };

// ===== 사진 주소 규칙: {base}/{상품번호}/thumb.webp, 1.webp ~ N.webp =====
const ver = (p) => (p.v ? `?v=${p.v}` : '');   // 대표 사진 교체 시 새 사진 받아오기
const thumbUrl = (p) => `${state.base}/${p.id}/thumb.webp${ver(p)}`;
const photoUrl = (p, n) => `${state.base}/${p.id}/${n}.webp${ver(p)}`;

// 사진이 없을 때 대체 이미지
function fallback(img, label) {
  img.onerror = null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="#e3d5ca"/><text x="150" y="205" font-size="24" text-anchor="middle" fill="#8a7d74" font-family="sans-serif">${label}</text></svg>`;
  img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// 가격 없으면 빈칸 (표시 생략)
const priceText = (p) => (p.price ? Number(p.price).toLocaleString('ko-KR') + '원' : '');

// ===== 탭 =====
function makeTabs(el, list, key) {
  el.innerHTML = '';
  list.forEach((name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    if (state[key] === name) b.className = 'on';
    b.onclick = () => {
      state[key] = name;
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      applyFilter();
    };
    el.appendChild(b);
  });
}

// ===== 목록 =====
let filtered = [];   // 필터 결과 (최신순)
// 무작위 섞기
function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
function applyFilter() {
  const q = state.q.trim().toLowerCase();
  filtered = state.items.filter((p) =>
    (state.cat1 === 'all' || p.cat1 === state.cat1) &&
    (state.cat2 === 'all' || p.cat2 === state.cat2) &&
    (!q || [p.id, p.name, p.desc].join(' ').toLowerCase().includes(q))
  );
  // 신상 가로줄: 최근 등록 50개 중 무작위 18개, 접속할 때마다 바뀜 (검색 중엔 숨김)
  const row = $('#newrow');
  row.innerHTML = '';
  if (!q) shuffle(filtered.slice(0, CONFIG.newPool)).slice(0, CONFIG.newCount).forEach((p) => row.appendChild(makeCard(p)));
  row.scrollLeft = 0;
  $('#newbox').hidden = !row.children.length;
  renderGrid();
  window.scrollTo(0, 0);
}

// 정렬기준 적용 후 전체 목록 다시 그림 (가격 없는 상품은 가격순에서 맨 뒤)
function renderGrid() {
  const s = state.sort;
  state.view = s === 'old' ? [...filtered].reverse()
    : s === 'low' || s === 'high' ? [...filtered].sort((a, b) =>
        (!a.price) - (!b.price) || (s === 'low' ? 1 : -1) * (a.price - b.price))
    : filtered;
  $('#grid').innerHTML = '';
  state.shown = 0;
  $('#empty').hidden = state.view.length > 0;
  renderMore();
}

function makeCard(p) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = '#/' + p.id;
  a.innerHTML = `<div class="thumb"><img loading="lazy" decoding="async" alt="" draggable="false"></div>`
    + (p.price ? `<div class="price">${priceText(p)}</div>` : '');
  const img = a.querySelector('img');
  img.onerror = () => fallback(img, p.id);
  img.src = thumbUrl(p);
  return a;
}

function renderMore() {
  const next = state.view.slice(state.shown, state.shown + CONFIG.pageSize);
  next.forEach((p) => $('#grid').appendChild(makeCard(p)));
  state.shown += next.length;
}

$('#sort').onchange = (e) => { state.sort = e.target.value; renderGrid(); };

// 맨 아래 도착 시에만 TOP 버튼 표시 (위로 올라가면 다시 숨김)
window.addEventListener('scroll', () => {
  const end = scrollY > 300 && innerHeight + scrollY >= document.documentElement.scrollHeight - 80;
  $('#totop').hidden = !end;
}, { passive: true });
$('#totop').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

// 아래로 스크롤하면 다음 상품 추가 (지연 로딩)
new IntersectionObserver((e) => {
  if (e[0].isIntersecting && state.shown < state.view.length) renderMore();
}, { rootMargin: '800px' }).observe($('#more'));

let timer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(timer);
  timer = setTimeout(() => { state.q = e.target.value; applyFilter(); }, 250);
});

// ===== 상세 화면 =====
let current = null, slideNo = 1;
function openDetail(id) {
  const p = state.items.find((x) => x.id === id);
  if (!p) { closeDetail(); return; }
  current = p;   if (window.gtag) gtag('event', 'view_item', { item_id: p.id, item_name: p.name || p.id });
  const total = Math.max(1, Number(p.photos) || 1);
  const loop = total > 1;
  // 끝없이 넘기기: [마지막 사진 복제, 1 ~ N, 첫 사진 복제]
  const order = loop ? [total, ...Array.from({ length: total }, (_, i) => i + 1), 1] : [1];
  const box = $('#slides');
  box.innerHTML = '';
  order.forEach((n, i) => {
    const s = document.createElement('div');
    s.className = 'slide';
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    if (i !== (loop ? 1 : 0)) img.loading = 'lazy';
    img.onerror = () => fallback(img, `${p.id} (${n})`);
    img.src = photoUrl(p, n);
    s.appendChild(img);
    box.appendChild(s);
  });
  const show = (n) => { slideNo = n; $('#count').textContent = `${n} / ${total}`; };
  show(1);
  $('#count').hidden = $('#prev').hidden = $('#next').hidden = !loop;
  let t;
  box.onscroll = () => {
    const pos = Math.round(box.scrollLeft / box.clientWidth);
    show(loop ? ((pos - 1 + total) % total) + 1 : 1);
    // 복제 사진에 멈추면 같은 진짜 사진 위치로 순간 이동
    clearTimeout(t);
    t = setTimeout(() => {
      if (!loop) return;
      const w = box.clientWidth, at = Math.round(box.scrollLeft / w);
      if (at === 0) box.scrollLeft = total * w;
      else if (at === total + 1) box.scrollLeft = w;
    }, 150);
  };
  $('#pid').textContent = 'No. ' + p.id;
  $('#pname').textContent = p.name || '';
  $('#pname').hidden = !p.name;
  $('#pprice').textContent = priceText(p);
  $('#pprice').hidden = !p.price;
  $('#pdesc').textContent = p.desc || '';
  $('#pdesc').hidden = !p.desc;
  $('#detail').hidden = false;
  $('#detail').scrollTop = 0;
  box.scrollLeft = loop ? box.clientWidth : 0;   // 화면 표시 후 1번 사진 위치로
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  current = null;
  $('#guide').hidden = true;
  $('#detail').hidden = true;
  document.body.style.overflow = '';
}

let fromList = false;
document.addEventListener('click', (e) => { if (e.target.closest('.card')) fromList = true; });
// 사진 좌우 이동 버튼
const slideBy = (d) => $('#slides').scrollBy({ left: d * $('#slides').clientWidth, behavior: 'smooth' });
$('#prev').onclick = () => slideBy(-1);
$('#next').onclick = () => slideBy(1);
$('#back').onclick = () => {
  if (fromList) history.back();
  else location.hash = '';
};

function route() {
  const m = location.hash.match(/^#\/(.+)$/);
  if (m) openDetail(decodeURIComponent(m[1]));
  else { closeDetail(); fromList = false; }
}
window.addEventListener('hashchange', route);

// ===== 문의: 상품번호 복사 → 카카오톡 채널 이동 =====
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  legacyCopy(text);
  return Promise.resolve();
}
function legacyCopy(text) {
  const t = document.createElement('textarea');
  t.value = text;
  t.style.position = 'fixed';
  t.style.opacity = '0';
  document.body.appendChild(t);
  t.select();
  try { document.execCommand('copy'); } catch (e) {}
  t.remove();
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 2000);
}
// 문의 버튼 → 안내 화면 표시
const askText = (p) => `이 상품을 문의합니다\n상품번호 ${p.id}\n${location.origin}${location.pathname}#/${p.id}`;
$('#ask').onclick = () => {
  if (!current) return;
  const img = $('#gthumb');
  img.onerror = () => fallback(img, current.id);
  img.src = thumbUrl(current);
  $('#guide').hidden = false;
};
$('#gclose').onclick = () => { $('#guide').hidden = true; };
$('#guide').onclick = (e) => { if (e.target.id === 'guide') $('#guide').hidden = true; };
// 노란 버튼: 문의 내용 복사 → 카카오톡 채널 이동
$('#go').onclick = async () => {
  if (!current) return;
  if (window.gtag) gtag('event', 'ask_click', { item_id: current.id });   await copyText(askText(current));
  toast('문의 내용 복사됨');
  setTimeout(() => { $('#guide').hidden = true; location.href = CONFIG.kakaoUrl; }, 600);
};

// ===== 확대 보기: 확대 버튼 → 두 손가락(PC는 휠·드래그)으로 확대·이동 → 닫기 =====
const vw = $('#viewer'), vimg = $('#vimg');
const zs = { s: 1, x: 0, y: 0 };
const pts = new Map();
let pinch = null, drag = null, lastTap = 0;
const applyZoom = () => { vimg.style.transform = `translate(${zs.x}px, ${zs.y}px) scale(${zs.s})`; };
// (cx, cy) 지점을 기준으로 배율 변경 (1~5배)
function zoomAt(cx, cy, ns) {
  ns = Math.min(5, Math.max(1, ns));
  const r = vw.getBoundingClientRect();
  const ox = cx - r.left - r.width / 2, oy = cy - r.top - r.height / 2;
  zs.x = ns === 1 ? 0 : ox - (ox - zs.x) * ns / zs.s;
  zs.y = ns === 1 ? 0 : oy - (oy - zs.y) * ns / zs.s;
  zs.s = ns;
  applyZoom();
}
vw.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  vw.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 2) {
    const [a, b] = [...pts.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: zs.s };
  } else if (pts.size === 1) {
    drag = { x: e.clientX - zs.x, y: e.clientY - zs.y };
    const now = Date.now();   // 두 번 톡톡 → 2.5배 / 원래대로
    if (now - lastTap < 300) zoomAt(e.clientX, e.clientY, zs.s > 1 ? 1 : 2.5);
    lastTap = now;
  }
});
vw.addEventListener('pointermove', (e) => {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 2 && pinch) {
    const [a, b] = [...pts.values()];
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
  } else if (pts.size === 1 && drag && zs.s > 1) {
    zs.x = e.clientX - drag.x;
    zs.y = e.clientY - drag.y;
    applyZoom();
  }
});
const lift = (e) => {
  pts.delete(e.pointerId);
  if (pts.size < 2) pinch = null;
  const rest = [...pts.values()][0];
  drag = rest ? { x: rest.x - zs.x, y: rest.y - zs.y } : null;
};
vw.addEventListener('pointerup', lift);
vw.addEventListener('pointercancel', lift);
vw.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, zs.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
}, { passive: false });

function openViewer() {
  if (!current) return;
  vimg.src = photoUrl(current, slideNo);
  zs.s = 1; zs.x = 0; zs.y = 0;
  applyZoom();
  vw.hidden = false;
  history.pushState({ viewer: 1 }, '');   // 휴대폰 뒤로가기 = 닫기
}
$('#zoom').onclick = openViewer;
$('#vclose').onclick = () => history.back();
window.addEventListener('popstate', () => {
  if (vw.hidden) return;
  vw.hidden = true;
  vimg.removeAttribute('src');
});

// ===== 사진 보호: 우클릭·길게 누르기 메뉴, 드래그, 저장 단축키(Ctrl+S·U·P) 차단 =====
document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
document.addEventListener('dragstart', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && ['s', 'u', 'p'].includes(e.key.toLowerCase())) e.preventDefault();
});

// ===== 시작 =====
makeTabs($('#cat1'), CONFIG.cat1, 'cat1');
makeTabs($('#cat2'), CONFIG.cat2, 'cat2');
fetch(CONFIG.dataUrl, { cache: 'no-cache' })
  .then((r) => r.json())
  .then((data) => {
    state.base = (data.base || '').replace(/\/$/, '');
    state.items = (data.items || [])
      .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    // 상품명 있는 상품이 하나라도 있을 때만 검색창 표시
    $('#search').hidden = !state.items.some((p) => p.name);
    // 가격 있는 상품이 없으면 가격순 정렬 숨김
    if (!state.items.some((p) => p.price)) $('#sort').querySelectorAll('[value=low],[value=high]').forEach((o) => o.remove());
    applyFilter();
    route();
  })
  .catch(() => { $('#empty').textContent = '상품 정보를 불러오지 못함'; $('#empty').hidden = false; });
