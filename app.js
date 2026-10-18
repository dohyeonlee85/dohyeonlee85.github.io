// ===== 설정 (카테고리 추가·삭제는 여기서) =====
const CONFIG = {
  dataUrl: 'products.json',
  kakaoUrl: 'http://pf.kakao.com/_TcxlBX/chat',
  cat1: ['all', 'clothes-women', 'clothes-men'],
  cat2: ['all', 'top', 'bottom', 'outer', 'shoes', 'etc'],
  pageSize: 60, // 한 번에 그리는 상품 수 (스크롤 시 추가)
};

const $ = (s) => document.querySelector(s);
const state = { base: '', items: [], view: [], shown: 0, cat1: 'all', cat2: 'all', q: '', lastWeek: null, grid: null };

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

// ===== 주차 계산 (월요일 시작) =====
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const THIS_MONDAY = mondayOf(new Date());
function weekAgo(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.max(0, Math.round((THIS_MONDAY - mondayOf(new Date(y, m - 1, d))) / 604800000));
}
const weekLabel = (n) => (n === 0 ? '이번 주 신상' : n === 1 ? '지난주' : `${n}주 전`);

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
function applyFilter() {
  const q = state.q.trim().toLowerCase();
  state.view = state.items.filter((p) =>
    (state.cat1 === 'all' || p.cat1 === state.cat1) &&
    (state.cat2 === 'all' || p.cat2 === state.cat2) &&
    (!q || [p.id, p.name, p.desc].join(' ').toLowerCase().includes(q))
  );
  $('#list').innerHTML = '';
  state.shown = 0;
  state.lastWeek = null;
  $('#empty').hidden = state.view.length > 0;
  renderMore();
  window.scrollTo(0, 0);
}

function renderMore() {
  const next = state.view.slice(state.shown, state.shown + CONFIG.pageSize);
  next.forEach((p) => {
    if (p._week !== state.lastWeek) {
      state.lastWeek = p._week;
      const g = document.createElement('section');
      g.className = 'group';
      g.innerHTML = `<h2>${weekLabel(p._week)}</h2><div class="grid"></div>`;
      $('#list').appendChild(g);
      state.grid = g.querySelector('.grid');
    }
    const a = document.createElement('a');
    a.className = 'card';
    a.href = '#/' + p.id;
    a.innerHTML = `<div class="thumb"><img loading="lazy" decoding="async" alt="" draggable="false"></div>
      <div class="price">${priceText(p)}</div>`;
    const img = a.querySelector('img');
    img.onerror = () => fallback(img, p.id);
    img.src = thumbUrl(p);
    state.grid.appendChild(a);
  });
  state.shown += next.length;
}

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
let current = null;
function openDetail(id) {
  const p = state.items.find((x) => x.id === id);
  if (!p) { closeDetail(); return; }
  current = p;
  const total = Math.max(1, Number(p.photos) || 1);
  const box = $('#slides');
  box.innerHTML = '';
  for (let n = 1; n <= total; n++) {
    const s = document.createElement('div');
    s.className = 'slide';
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    if (n > 1) img.loading = 'lazy';
    img.onerror = () => fallback(img, `${p.id} (${n})`);
    img.src = photoUrl(p, n);
    s.appendChild(img);
   
      
      
    box.appendChild(s);
  }
  box.scrollLeft = 0;
  const nav = (i) => {
    $('#count').textContent = `${i} / ${total}`;
    $('#prev').hidden = i <= 1;
    $('#next').hidden = i >= total;
  };
  nav(1);
  box.onscroll = () => nav(Math.round(box.scrollLeft / box.clientWidth) + 1);
  $('#pid').textContent = 'No. ' + p.id;
  $('#pname').textContent = p.name || '';
  $('#pname').hidden = !p.name;
  $('#pprice').textContent = priceText(p);
  $('#pprice').hidden = !p.price;
  $('#pdesc').textContent = p.desc || '';
  $('#pdesc').hidden = !p.desc;
  $('#detail').hidden = false;
  $('#detail').scrollTop = 0;
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
  await copyText(askText(current));
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
  const box = $('#slides');
  vimg.src = photoUrl(current, Math.round(box.scrollLeft / box.clientWidth) + 1);
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
      .map((p) => ({ ...p, _week: weekAgo(p.date) }))
      .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    // 상품명 있는 상품이 하나라도 있을 때만 검색창 표시
    $('#search').hidden = !state.items.some((p) => p.name);
    applyFilter();
    route();
  })
  .catch(() => { $('#empty').textContent = '상품 정보를 불러오지 못함'; $('#empty').hidden = false; });
