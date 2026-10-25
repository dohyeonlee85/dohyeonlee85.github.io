// shop 사진 일괄 업로드 (시트 "shop 상품 목록"에 연결된 Apps Script, realtime.gs·storage.gs와 같은 프로젝트)
// 사이트별 폴더·탭: shop01 '업로드' / shop03 '업로드03' / shop04 '업로드04' (03·04 폴더는 '업로드' 폴더 안에 자동 생성)
// 5분마다: 업로드 폴더에 새 사진이 있고 3분간 추가 업로드가 없으면 → Actions 실행 (상품별 묶기·등록)
// 업로드 탭에서 분류·상품명 등을 고치면 → 2분간 수정이 없을 때 Actions 실행 (사이트 반영)
// 처리 끝난 사진은 각 폴더의 '완료' 폴더로 이동, keepDays일 지나면 영구 삭제 (사이트 사진은 R2에 영구 보관)
// 처음 한 번 installUpload 실행 → 이후 자동

const SITES = [
  { folder: '업로드', tab: '업로드', keepDays: 120 },
  { folder: '업로드03', tab: '업로드03', parent: '업로드', keepDays: 3 },
  { folder: '업로드04', tab: '업로드04', parent: '업로드', keepDays: 3 },
];
const DONE_FOLDER = '완료';
const QUIET_MIN = 3;        // 마지막 업로드 후 대기 (업로드 도중 실행 방지)
const EDIT_QUIET_MIN = 2;   // 마지막 시트 수정 후 대기
const RETRY_MIN = 20;       // 실행 요청 후 사진이 그대로면 다시 요청하는 간격

function installUpload() {
  const names = ['checkUpload', 'onUploadEdit', 'cleanOriginals'];
  ScriptApp.getProjectTriggers()
    .filter(t => names.includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkUpload').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('onUploadEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  ScriptApp.newTrigger('cleanOriginals').timeBased().everyDays(1).atHour(5).create();
  SITES.forEach(s => uploadFolder(s));   // 업로드03·04 폴더 없으면 만들기
  checkUpload();   // 시험 실행 (실행 로그에 '업로드 확인' 표시되면 성공)
}

function onUploadEdit(e) {
  if (!e || e.range.getRow() < 2) return;
  const name = e.range.getSheet().getName();
  if (!SITES.some(s => s.tab === name)) return;
  PropertiesService.getScriptProperties().setProperty('EDITED_AT', String(Date.now()));
}

function checkUpload() {
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  let pending = 0, newest = 0;

  SITES.forEach(s => {
    const folder = uploadFolder(s);
    const done = doneFolder(folder);
    const recorded = recordedIds(s.tab);
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (!f.getMimeType().startsWith('image/')) continue;
      if (recorded.has(f.getId())) {
        f.moveTo(done);   // Actions가 처리한 사진 → 완료 폴더
      } else {
        pending++;
        newest = Math.max(newest, f.getDateCreated().getTime());
      }
    }
  });

  const last = Number(props.getProperty('DISPATCHED_AT') || 0);
  const edited = Number(props.getProperty('EDITED_AT') || 0);
  const newPhotos = pending && now - newest > QUIET_MIN * 60000 && now - last > RETRY_MIN * 60000;
  const newEdits = edited > last && now - edited > EDIT_QUIET_MIN * 60000;
  console.log(`업로드 확인: 새 사진 ${pending}장, 시트 수정 ${newEdits ? '있음' : '없음'}`);
  if (newPhotos || newEdits) {
    runSync();   // realtime.gs
    props.setProperty('DISPATCHED_AT', String(now));
  }
}

function cleanOriginals() {
  const start = Date.now();
  let n = 0;
  SITES.forEach(s => {
    const cutoff = Date.now() - s.keepDays * 24 * 60 * 60 * 1000;
    const files = doneFolder(uploadFolder(s)).getFiles();
    while (files.hasNext() && Date.now() - start < 5 * 60 * 1000) {
      const f = files.next();
      if (f.getDateCreated().getTime() < cutoff) {
        deleteFile(f.getId());   // storage.gs (휴지통 거치지 않고 영구 삭제)
        n++;
      }
    }
  });
  console.log(`원본 사진 정리: ${n}장`);
}

function uploadFolder(site) {
  if (!site.parent) {
    const it = DriveApp.getFoldersByName(site.folder);
    if (!it.hasNext()) throw new Error(`드라이브에 '${site.folder}' 폴더 없음`);
    return it.next();
  }
  // '업로드' 폴더 안에 두면 서비스 계정 공유가 그대로 이어짐
  const parent = uploadFolder(SITES.find(s => s.folder === site.parent));
  const it = parent.getFoldersByName(site.folder);
  return it.hasNext() ? it.next() : parent.createFolder(site.folder);
}

function doneFolder(parent) {
  const it = parent.getFoldersByName(DONE_FOLDER);
  return it.hasNext() ? it.next() : parent.createFolder(DONE_FOLDER);
}

function recordedIds(tab) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(tab);
  if (!sheet || sheet.getLastRow() < 2) return new Set();
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = header.indexOf('파일') + 1;
  if (!col) return new Set();
  const ids = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues()
    .flatMap(r => String(r[0]).split(',')).filter(Boolean);
  return new Set(ids);
}
