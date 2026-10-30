// ===== 설정 (카테고리 추가·삭제는 여기서) =====
const CONFIG = {
  dataUrl: 'products.json',
  kakaoUrl: 'http://pf.kakao.com/_TcxlBX/chat',
  cat1: ['all', 'padding', 'coat', 'shoes', 'muffler'],
  // 대분류별 소분류 (여기 없는 대분류는 소분류 탭 숨김)
  sub: {
    padding: ['women', 'men'],
    coat: ['women', 'men'],
    shoes: ['boots', 'slides', 'flats', 'loafers', 'heels', 'sneakers', 'etc'],
  },
  pageSize: 60, // 한 번에 그리는 상품 수 (스크롤 시 추가)
  newCount: 20, // 신상 가로줄 상품 수
  newPool: 40,  // 신상 후보: 최근 등록 40개 중 무작위 선택
  newAuto: 2500, // 신상 자동 넘김 간격(ms), 0 = 자동 넘김 끄기
  newHold: 3000, // 손으로 넘긴 뒤 자동 넘김 다시 시작까지(ms)
  // ===== 기능 스위치 (true = 켜기, false = 끄기) =====
  quickAsk: true,   // 문의 1탭: 안내 팝업 없이 바로 복사 + 카톡 새 창 (false = 기존 안내 팝업)
  priceHide: true,  // 가격 전면 비공개 (카드·상세·장바구니)
  backHint: true,   // 카톡 갔다 돌아오면 '비슷한 상품 더 보기' 5초 표시
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

// 가격 없거나 priceHide 켜면 빈칸 (표시 생략)
const showPrice = (p) => !CONFIG.priceHide && !!p.price;
const priceText = (p) => (showPrice(p) ? Number(p.price).toLocaleString('ko-KR') + '원' : '');
// 문의 버튼 아래 작은 안내 (quickAsk 켰을 때만)
if (!CONFIG.quickAsk) document.querySelectorAll('.khint').forEach((e) => e.remove());

// ===== 대분류 칩 줄 (헤더 아래 상시 표시) =====
function renderChips() {
  const box = $('#chips');
  box.innerHTML = '';
  CONFIG.cat1.forEach((name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    if (state.cat1 === name) b.className = 'on';
    b.onclick = () => setCat(name, 'all');
    box.appendChild(b);
  });
  const on = box.querySelector('.on');
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ===== ☰ 메뉴: 소분류 있는 대분류별 소분류 목록 (대분류 이름 = 그 대분류 전체) =====
function menuList() {
  const ul = $('#mlist');
  ul.innerHTML = '';
  const add = (text, cls, on, fn) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.className = cls + (on ? ' on' : '');
    b.onclick = fn;
    li.appendChild(b);
    ul.appendChild(li);
  };
  Object.keys(CONFIG.sub).forEach((c1) => {
    add(c1, 'mhead', state.cat1 === c1 && state.cat2 === 'all', () => setCat(c1, 'all'));
    CONFIG.sub[c1].forEach((c2) => add(c2, 'msub', state.cat1 === c1 && state.cat2 === c2, () => setCat(c1, c2)));
  });
  ul.scrollTop = 0;
}
function setCat(c1, c2) {
  state.cat1 = c1;
  state.cat2 = c2;
  closeMenu();
  applyFilter();
}
function openMenu() {
  menuList();
  $('#menu').hidden = false;
  document.body.style.overflow = 'hidden';
  history.pushState({ menu: 1 }, '');   // 휴대폰 뒤로가기 = 메뉴 닫기
}
function closeMenu() {
  if ($('#menu').hidden) return;
  $('#menu').hidden = true;
  document.body.style.overflow = '';
  if (history.state && history.state.menu) history.back();
}
$('#mbtn').onclick = openMenu;
$('#mclose').onclick = closeMenu;
window.addEventListener('popstate', () => {
  if ($('#menu').hidden) return;
  $('#menu').hidden = true;
  document.body.style.overflow = '';
});
// 소분류 표시 줄 (소분류 선택 시만), ✕ → 대분류 전체로
function showCrumb() {
  renderChips();
  $('#crumbt').textContent = state.cat1 + ' › ' + state.cat2;
  $('#crumb').hidden = state.cat2 === 'all';
}
$('#crumbx').onclick = () => setCat(state.cat1, 'all');

// ===== 🔍 검색: 아이콘 누르면 검색창 펼침, 다시 누르면 지우고 닫기 =====
$('#sbtn').onclick = () => {
  const open = $('.bar').classList.toggle('searching');
  if (open) { $('#search').focus(); return; }
  $('#search').value = '';
  if (state.q) { state.q = ''; applyFilter(); }
};

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
  // 신상 가로줄: 최근 등록 40개 중 무작위 20개, 접속할 때마다 바뀜 (검색 중엔 숨김)
  renderNew(q ? [] : shuffle(filtered.slice(0, CONFIG.newPool)).slice(0, CONFIG.newCount));
  showCrumb();
  renderGrid();
  window.scrollTo(0, 0);
}

// ===== 신상 가로줄: 2.5초마다 1장씩 다음 카드로 자동 넘김, 끝나면 1번으로 이어짐 =====
// 끝없이 넘기기: 뒤에 앞쪽 카드 복제 → 복제한 1번에 도착하면 진짜 1번 위치로 순간 이동
// 손으로 밀면 멈췄다가 손 뗀 뒤 3초 후 다시 시작. 화면 밖·상세·장바구니·다른 탭이면 정지
const nr = { row: $('#newrow'), n: 0, loop: false, hold: 0, touch: false, anim: 0, seen: false };
function renderNew(list) {
  const row = nr.row;
  row.innerHTML = '';
  list.forEach((p) => row.appendChild(makeCard(p)));
  nr.n = list.length;
  // 화면에 다 보이면(PC 4장 이하, 휴대폰 1장) 자동 넘김 없음
  nr.loop = nr.n > (matchMedia('(min-width: 700px)').matches ? 4 : 1);
  if (nr.loop) list.slice(0, 4).forEach((p) => {
    const c = makeCard(p);
    c.tabIndex = -1;
    c.setAttribute('aria-hidden', 'true');
    row.appendChild(c);
  });
  cancelAnimationFrame(nr.anim);
  row.scrollLeft = 0;
  $('#newbox').hidden = !nr.n;
  newNo();
}
const newStep = () => { const c = nr.row.children; return c.length > 1 ? c[1].offsetLeft - c[0].offsetLeft : 0; };
const newAt = () => { const w = newStep(); return w ? Math.round(nr.row.scrollLeft / w) : 0; };
function newNo() { $('#newno').textContent = nr.n > 1 ? `${(newAt() % nr.n) + 1} / ${nr.n}` : ''; }
// 0.4초 부드럽게 미끄러지기 (스냅은 이동 중에만 끔)
function slideTo(x) {
  const row = nr.row, from = row.scrollLeft, t0 = performance.now();
  row.classList.add('moving');
  cancelAnimationFrame(nr.anim);
  const go = (now) => {
    const k = Math.min(1, (now - t0) / 400);
    row.scrollLeft = from + (x - from) * (1 - Math.pow(1 - k, 3));
    if (k < 1) nr.anim = requestAnimationFrame(go);
    else { row.classList.remove('moving'); newWrap(); }
  };
  nr.anim = requestAnimationFrame(go);
}
// 복제 구간에 들어가면 같은 진짜 카드 위치로 순간 이동
function newWrap() {
  const w = newStep();
  if (nr.loop && w && newAt() >= nr.n) nr.row.scrollLeft -= nr.n * w;
}
function newTick() {
  const run = CONFIG.newAuto && nr.loop && nr.seen && !nr.touch && Date.now() > nr.hold
    && !document.hidden && $('#detail').hidden && $('#cartpage').hidden && $('#menu').hidden
    && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (run) slideTo((newAt() + 1) * newStep());
}
if (CONFIG.newAuto) setInterval(newTick, CONFIG.newAuto);
new IntersectionObserver((e) => { nr.seen = e[0].isIntersecting; }).observe(nr.row);
const newStop = () => { nr.touch = true; cancelAnimationFrame(nr.anim); nr.row.classList.remove('moving'); };
const newGo = () => { nr.touch = false; nr.hold = Date.now() + CONFIG.newHold; };
nr.row.addEventListener('pointerdown', newStop);
nr.row.addEventListener('touchstart', newStop, { passive: true });
['pointerup', 'pointercancel', 'touchend', 'touchcancel'].forEach((t) => nr.row.addEventListener(t, newGo, { passive: true }));
nr.row.addEventListener('wheel', () => { nr.hold = Date.now() + CONFIG.newHold; }, { passive: true });
let nrT;
nr.row.addEventListener('scroll', () => {
  newNo();
  if (nr.row.classList.contains('moving')) return;
  clearTimeout(nrT);
  nrT = setTimeout(newWrap, 150);   // 손으로 넘긴 경우: 멈춘 뒤 복제 구간 정리
}, { passive: true });

// 정렬기준 적용 후 전체 목록 다시 그림 (인기순: 최근 30일 조회수, 같으면 최신순)
function renderGrid() {
  const s = state.sort;
  state.view = s === 'old' ? [...filtered].reverse()
    : s === 'pop' ? [...filtered].sort((a, b) => (b.pop || 0) - (a.pop || 0))
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
    + (showPrice(p) ? `<div class="price">${priceText(p)}</div>` : '');
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

// 정렬 버튼 → 아래로 펼침 목록
const sortList = $('#sortlist');
$('#sortbtn').onclick = (e) => { e.stopPropagation(); sortList.hidden = !sortList.hidden; };
sortList.querySelectorAll('button').forEach((b) => {
  b.onclick = () => {
    state.sort = b.dataset.v;
    $('#sortt').textContent = b.textContent;
    sortList.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    sortList.hidden = true;
    renderGrid();
  };
});
sortList.querySelector('[data-v=new]').classList.add('on');
document.addEventListener('click', (e) => { if (!e.target.closest('#sortbox')) sortList.hidden = true; });

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
  current = p;
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
  // 상세 사진: 타이틀 사진 1 ~ N을 세로로 나열, 사진별 돋보기
  const dp = $('#dphotos');
  dp.innerHTML = '';
  for (let n = 1; n <= total; n++) {
    const s = document.createElement('div');
    s.className = 'dphoto';
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.loading = 'lazy';
    img.onerror = () => fallback(img, `${p.id} (${n})`);
    img.src = photoUrl(p, n);
    const z = $('#zoomtpl').content.firstElementChild.cloneNode(true);
    z.onclick = () => openViewer(n);
    s.append(img, z);
    dp.appendChild(s);
  }
  $('#pid').textContent = 'No. ' + p.id;
  $('#pname').textContent = p.name || '';
  $('#pname').hidden = !p.name;
  $('#pprice').textContent = priceText(p);
  $('#pprice').hidden = !showPrice(p);
  $('#pdesc').textContent = p.desc || '';
  $('#pdesc').hidden = !p.desc;
  $('#detail').hidden = false;
  $('#detail').scrollTop = 0;
  // 인기순용 조회 기록 (GA4 → Actions가 하루 1회 products.json에 반영)
  if (window.gtag) gtag('event', 'view_item', { items: [{ item_id: p.id, item_name: p.name || p.id }] });
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
document.addEventListener('click', (e) => {
  if (e.target.closest('.card, .cthumb')) fromList = true;   // 목록·장바구니에서 상세로
  if (e.target.closest('.cartlink')) cartFrom = true;   // 상단 🛒(목록·상세)에서 장바구니로
});
// 사진 좌우 이동 버튼
const slideBy = (d) => $('#slides').scrollBy({ left: d * $('#slides').clientWidth, behavior: 'smooth' });
$('#prev').onclick = () => slideBy(-1);
$('#next').onclick = () => slideBy(1);
$('#back').onclick = () => {
  if (fromList) history.back();
  else location.hash = '';
};
$('#dtop').onclick = () => $('#detail').scrollTo({ top: 0, behavior: 'smooth' });

function route() {
  if (location.hash === '#/cart') { closeDetail(); openCart(); return; }
  closeCart();
  const m = location.hash.match(/^#\/(.+)$/);
  if (m) openDetail(decodeURIComponent(m[1]));
  else { closeDetail(); fromList = false; cartFrom = false; }
}
window.addEventListener('hashchange', () => { $('#hint').hidden = true; route(); });   // 화면 바뀌면 복귀 안내 닫기

// ===== 문의: 상품번호 복사 → 카카오톡 채널 이동 =====
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  legacyCopy(text);
  return Promise.resolve();
}
function legacyCopy(text) {
  const t = document.createElement('textarea');
  t.value = text;
  t.setAttribute('readonly', '');
  t.style.position = 'fixed';
  t.style.top = '0';
  t.style.opacity = '0';
  document.body.appendChild(t);
  t.select();
  t.setSelectionRange(0, text.length);   // 아이폰
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) {}
  t.remove();
  return ok;
}
// link: 알림 오른쪽 버튼 [글자, 주소] (있으면 3초 표시)
function toast(msg, link) {
  const t = $('#toast');
  t.textContent = msg;
  if (link) {
    const a = document.createElement('a');
    a.textContent = link[0];
    a.href = link[1];
    a.onclick = () => { t.hidden = true; cartFrom = true; };
    t.appendChild(a);
  }
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, link ? 3000 : 2000);
}
// 문의 버튼 → 안내 화면 표시 (상세: 이 상품 / 장바구니: 담은 상품 전체)
const linkOf = (id) => `${location.origin}${location.pathname}#/${id}`;
const askText = (p) => `이 상품을 문의합니다\n상품번호 ${p.id}\n${linkOf(p.id)}`;
let askMsg = '', askPs = [];   // 노란 버튼으로 복사할 문의 내용·상품
function openGuide(text, ps) {
  askMsg = text;
  askPs = ps;
  const p = ps[0];
  const img = $('#gthumb');
  img.onerror = () => fallback(img, p.id);
  img.src = thumbUrl(p);
  $('#guide').hidden = false;
}
$('#ask').onclick = () => { if (current) ask([current], askText(current)); };
$('#gclose').onclick = () => { $('#guide').hidden = true; };
$('#guide').onclick = (e) => { if (e.target.id === 'guide') $('#guide').hidden = true; };
// 노란 버튼: 문의 내용 복사 → 카카오톡 채널 이동
$('#go').onclick = async () => {
  if (!askMsg) return;
  await copyText(askMsg);
  askDone(askPs);
  toast('문의 내용 복사됨');
  setTimeout(() => { $('#guide').hidden = true; location.href = CONFIG.kakaoUrl; }, 600);
};

// ps: 문의할 상품 목록, text: 복사할 문의 글 (상품번호 + 상품 링크)
function ask(ps, text) {
  if (!ps.length) return;
  if (CONFIG.quickAsk) askNow(ps, text);
  else openGuide(text, ps);
}
const ga = (name, ps) => { if (window.gtag) gtag('event', name, { items: ps.map((p) => ({ item_id: p.id, item_name: p.name || p.id })) }); };
// 문의함 표시 (이 휴대폰에만 저장)
const ASK_KEY = 'asked';
function askedGet() { try { return JSON.parse(localStorage.getItem(ASK_KEY)) || []; } catch (e) { return []; } }
function askDone(ps) {
  const a = new Set(askedGet());
  ps.forEach((p) => a.add(p.id));
  try { localStorage.setItem(ASK_KEY, JSON.stringify([...a].slice(-300))); } catch (e) {}
  try { sessionStorage.setItem('askback', ps[0].id); } catch (e) {}   // 복귀 안내용
  ga('kakao_inquiry', ps);
  if (!$('#cartpage').hidden) renderCart();
}
const goKakao = () => { window.open(CONFIG.kakaoUrl, '_blank') || (location.href = CONFIG.kakaoUrl); };
// quickAsk: 누르는 순간 복사 → 카톡 새 창 (복사 실패 시에만 글 상자)
function askNow(ps, text) {
  const done = () => { askDone(ps); goKakao(); };
  if (legacyCopy(text)) return done();
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(done, () => askFail(text, done));
}
let failDone = null;
function askFail(text, done) {
  failDone = done;
  $('#ftext').value = text;
  $('#fail').hidden = false;
}
$('#ftext').onfocus = () => $('#ftext').select();
$('#fgo').onclick = () => { $('#fail').hidden = true; if (failDone) failDone(); };
$('#fclose').onclick = () => { $('#fail').hidden = true; };
$('#fail').onclick = (e) => { if (e.target.id === 'fail') $('#fail').hidden = true; };

// ===== 복귀 안내: 카톡 갔다 돌아오면 '비슷한 상품 더 보기' 5초 (같은 분류 목록으로) =====
function backHint() {
  if (!CONFIG.backHint || document.hidden) return;
  let id = null;
  try { id = sessionStorage.getItem('askback'); sessionStorage.removeItem('askback'); } catch (e) {}
  if (!id) return;
  const h = $('#hint');
  h.hidden = false;
  h.onclick = () => {
    h.hidden = true;
    const p = findItem(id);
    location.hash = '';
    if (p) setCat(p.cat1, CONFIG.sub[p.cat1] && CONFIG.sub[p.cat1].includes(p.cat2) ? p.cat2 : 'all');
  };
  clearTimeout(backHint.t);
  backHint.t = setTimeout(() => { h.hidden = true; }, 5000);
}
document.addEventListener('visibilitychange', backHint);
window.addEventListener('pageshow', backHint);

// ===== 장바구니: 이 휴대폰·브라우저에만 저장, 담은 지 14일 지나면 자동 삭제 (수량 없음) =====
const CART_KEY = 'cart', CART_DAYS = 14;
let cart = [];   // [{id, t(담은 시각), s(false = 체크 해제)}]
try { cart = JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch (e) {}
const findItem = (id) => state.items.find((p) => p.id === id);
const won = (n) => n.toLocaleString('ko-KR') + '원';
// 저장 + 🛒 배지(담긴 상품 개수) 갱신: 목록 상단·상세 상단·담기 버튼
function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
  const n = cart.length;
  document.querySelectorAll('.cartn').forEach((el) => { el.textContent = n > 99 ? '99+' : n; el.hidden = !n; });
}
// 14일 지난 상품, 사이트에서 삭제된 상품 정리 (상품 목록 불러온 뒤 실행). 예전 수량(n) 값은 버림
function pruneCart() {
  const limit = Date.now() - CART_DAYS * 864e5;
  cart = cart.filter((c) => c.t > limit && findItem(c.id)).map(({ id, t, s }) => ({ id, t, s }));
  saveCart();
}
// 체크한 상품 (기본값 체크)
const picked = () => cart.filter((c) => c.s !== false);
// 상세 🛒 담기: 처음이면 담기, 이미 담았으면 알림만 (둘 다 3초 '장바구니 가기')
$('#add').onclick = () => {
  if (!current) return;
  const had = cart.some((x) => x.id === current.id);
  if (!had) { cart.push({ id: current.id, t: Date.now(), s: true }); saveCart(); ga('add_to_cart', [current]); }
  toast(had ? '이미 담긴 상품' : '장바구니에 담김', ['장바구니 가기', '#/cart']);
};
// ===== 장바구니 페이지 (#/cart) =====
let cartFrom = false;   // 상단 🛒·알림으로 들어왔으면 ← = 뒤로가기 (상세에서 왔으면 상세로)
function openCart() {
  renderCart();
  $('#cartpage').hidden = false;
  $('#cartpage').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}
function closeCart() {
  if ($('#cartpage').hidden) return;
  $('#guide').hidden = true;
  $('#cartpage').hidden = true;
  document.body.style.overflow = '';
}
$('#cback').onclick = () => {
  if (cartFrom) history.back();
  else location.hash = '';
};
function renderCart() {
  const ul = $('#clist');
  ul.innerHTML = '';
  const asked = new Set(askedGet());
  cart.forEach((c) => {
    const p = findItem(c.id);
    if (!p) return;
    const li = document.createElement('li');
    li.innerHTML = `<label class="chk"><input type="checkbox"><i></i></label>
      <a class="cthumb" href="#/${p.id}"><img alt="" draggable="false"></a>
      <div class="cinfo"><p class="cid">No. ${p.id}${asked.has(p.id) ? '<em class="ak">문의함</em>' : ''}</p><p class="cname"></p>
        <p class="cprice">${showPrice(p) ? won(Number(p.price)) : CONFIG.priceHide ? '' : '가격 문의'}</p></div>
      <button class="cx" type="button" aria-label="삭제">✕</button>`;
    const box = li.querySelector('input');
    box.checked = c.s !== false;
    box.onchange = () => { c.s = box.checked; saveCart(); renderCart(); };
    const img = li.querySelector('img');
    img.onerror = () => fallback(img, p.id);
    img.src = thumbUrl(p);
    li.querySelector('.cname').textContent = p.name || '';
    li.querySelector('.cx').onclick = () => { cart = cart.filter((x) => x !== c); saveCart(); renderCart(); };   // 개별 삭제 (확인 없음)
    ul.appendChild(li);
  });
  const n = picked().length, has = cart.length > 0;
  $('#call').checked = has && n === cart.length;
  $('#cseln').textContent = `(${n}/${cart.length})`;
  // 비었으면: 도구·하단 문의 버튼 숨기고 '쇼핑 계속하기'
  $('#cempty').hidden = has;
  $('.ctools').hidden = $('.cbtns').hidden = $('#cartpage .askbar').hidden = !has;
  $('#cgot').textContent = n ? `문의하기 (${n}개)` : '문의하기';
  $('#cgo').disabled = $('#cdel').disabled = !n;
}
$('#call').onchange = (e) => { cart.forEach((c) => { c.s = e.target.checked; }); saveCart(); renderCart(); };
$('#cdel').onclick = () => {
  const n = picked().length;
  if (!n || !confirm(`선택한 ${n}개 상품을 삭제할까요?`)) return;
  cart = cart.filter((c) => c.s === false);
  saveCart();
  renderCart();
};
$('#cclear').onclick = () => {
  if (!cart.length || !confirm('장바구니를 비울까요?')) return;
  cart = [];
  saveCart();
  renderCart();
};
$('.cshop').onclick = (e) => { e.preventDefault(); location.hash = ''; };
// 문의 내용 (체크한 상품만): 번호. 상품번호 (가격) + 링크
function cartText() {
  const lines = [`상품 ${picked().length}개 문의합니다`];
  picked().forEach((c, i) => {
    const p = findItem(c.id);
    lines.push(`${i + 1}. ${c.id}` + (p && showPrice(p) ? ` (${won(Number(p.price))})` : CONFIG.priceHide ? '' : ' (가격 문의)'), linkOf(c.id));
  });
  return lines.join('\n');
}
$('#cgo').onclick = () => { const s = picked().map((c) => findItem(c.id)).filter(Boolean); if (s.length) ask(s, cartText()); };   // 문의 후에도 장바구니 유지 (문의함 표시)

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

function openViewer(n) {
  if (!current) return;
  vimg.src = photoUrl(current, n);
  zs.s = 1; zs.x = 0; zs.y = 0;
  applyZoom();
  vw.hidden = false;
  history.pushState({ viewer: 1 }, '');   // 휴대폰 뒤로가기 = 닫기
}
$('#vclose').onclick = () => history.back();
window.addEventListener('popstate', () => {
  if (vw.hidden) return;
  vw.hidden = true;
  vimg.removeAttribute('src');
});

// ===== 사진 보호: 우클릭·길게 누르기 메뉴, 드래그, 저장 단축키(Ctrl+S·U·P) 차단 =====
document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
document.addEventListener('dragstart', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && ['s', 'u', 'p'].includes(e.key.toLowerCase())) e.preventDefault();
});

// ===== 시작 =====
fetch(CONFIG.dataUrl, { cache: 'no-cache' })
  .then((r) => r.json())
  .then((data) => {
    state.base = (data.base || '').replace(/\/$/, '');
    state.items = (data.items || [])
      .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    // 상품명 있는 상품이 하나라도 있을 때만 🔍 표시
    $('#sbtn').hidden = !state.items.some((p) => p.name);
    // 조회 기록이 아직 없으면 인기순 숨김
    if (!state.items.some((p) => p.pop)) sortList.querySelector('[data-v=pop]').parentNode.remove();
    pruneCart();
    applyFilter();
    route();
  })
  .catch(() => { $('#empty').textContent = '상품 정보를 불러오지 못함'; $('#empty').hidden = false; });
