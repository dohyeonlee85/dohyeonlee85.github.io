"""드라이브 '업로드' 폴더 사진 → 상품별 묶기 → WebP 변환 → R2 업로드 → 시트 '업로드' 탭.

묶기: 사진 파일 이름 = 저장 시각(1000분의 1초). 앞 사진과 GAP_MS 이상 벌어지면 다음 상품.
공개: '분류'를 고른 줄만 products.json에 반영. 분류를 지우면 사이트에서 내림.
대표: '대표' 칸에 사진 번호 입력 → 그 사진을 1번·썸네일로 교체 후 칸 비움.
정리: 업로드 후 KEEP_UNSORTED_DAYS일 지나도 분류 없는 줄 → 줄·R2 사진 삭제.
처리한 사진은 '파일' 열에 기록 (Apps Script가 '완료' 폴더로 옮김).
"""
import io
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

from PIL import Image

from sync import (ID_HEADER, THUMB_QUALITY, THUMB_WIDTH, col_letter, download,
                  google_services, make_images, next_id, put, to_price, webp)

UPLOAD_FOLDER = '업로드'
UPLOAD_TAB = '업로드'
GAP_MS = 1000             # 이 간격(1초) 이상 벌어지면 다음 상품
WORKERS = 4               # 사진 동시 처리 수
KEEP_UNSORTED_DAYS = 7    # 분류 없는 상품 보관 일수
MAX_ROWS = 5000
KST = timezone(timedelta(hours=9))
HEADER = [ID_HEADER, '썸네일', '사진수', '분류', '상품명', '가격', '설명', '상태', '파일', '대표', '버전']
CATS = {
    '여성-상의': ('clothes-women', 'top'), '여성-하의': ('clothes-women', 'bottom'),
    '여성-아우터': ('clothes-women', 'outer'), '여성-신발': ('clothes-women', 'shoes'),
    '여성-기타': ('clothes-women', 'etc'),
    '남성-상의': ('clothes-men', 'top'), '남성-하의': ('clothes-men', 'bottom'),
    '남성-아우터': ('clothes-men', 'outer'), '남성-신발': ('clothes-men', 'shoes'),
    '남성-기타': ('clothes-men', 'etc'),
}

_local = threading.local()


def thread_drive():
    # 드라이브 연결은 스레드끼리 공유 불가 → 스레드마다 하나씩
    if not hasattr(_local, 'drive'):
        _local.drive = google_services()[1]
    return _local.drive


def ensure_tab(sheets, sid):
    tabs = {s['properties']['title']: s['properties'] for s in
            sheets.spreadsheets().get(spreadsheetId=sid).execute()['sheets']}
    if UPLOAD_TAB in tabs:
        # 나중에 추가된 열(대표·버전 등)은 맨 오른쪽에 이어 붙임
        first = sheets.spreadsheets().values().get(
            spreadsheetId=sid, range=f"'{UPLOAD_TAB}'!1:1").execute().get('values', [[]])
        header = [str(h).strip() for h in (first[0] if first else [])]
        missing = [h for h in HEADER if h not in header]
        if missing:
            props = tabs[UPLOAD_TAB]
            short = len(header) + len(missing) - props['gridProperties']['columnCount']
            if short > 0:   # 시트 칸 수가 모자라면 먼저 늘림
                sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={'requests': [
                    {'appendDimension': {'sheetId': props['sheetId'], 'dimension': 'COLUMNS',
                                         'length': short}}]}).execute()
            sheets.spreadsheets().values().update(
                spreadsheetId=sid, range=f"'{UPLOAD_TAB}'!{col_letter(len(header) + 1)}1",
                valueInputOption='RAW', body={'values': [missing]}).execute()
        return
    res = sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={'requests': [
        {'addSheet': {'properties': {'title': UPLOAD_TAB, 'gridProperties': {
            'rowCount': MAX_ROWS, 'columnCount': len(HEADER), 'frozenRowCount': 1}}}}]}).execute()
    tid = res['replies'][0]['addSheet']['properties']['sheetId']
    cat_col = HEADER.index('분류')
    sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={'requests': [
        {'setDataValidation': {
            'range': {'sheetId': tid, 'startRowIndex': 1, 'endRowIndex': MAX_ROWS,
                      'startColumnIndex': cat_col, 'endColumnIndex': cat_col + 1},
            'rule': {'condition': {'type': 'ONE_OF_LIST',
                                   'values': [{'userEnteredValue': c} for c in CATS]},
                     'showCustomUi': True, 'strict': True}}},
        {'updateDimensionProperties': {   # 썸네일이 잘 보이게 행 높이·열 너비
            'range': {'sheetId': tid, 'dimension': 'ROWS', 'startIndex': 1, 'endIndex': MAX_ROWS},
            'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {
            'range': {'sheetId': tid, 'dimension': 'COLUMNS', 'startIndex': 1, 'endIndex': 2},
            'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
    ]}).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=sid, range=f"'{UPLOAD_TAB}'!A1", valueInputOption='RAW',
        body={'values': [HEADER]}).execute()


def read_tab(sheets, sid):
    """(header, [(시트 행 번호, 행)], get) — 상품번호 있는 행만."""
    rows = sheets.spreadsheets().values().get(
        spreadsheetId=sid, range=f"'{UPLOAD_TAB}'",
        valueRenderOption='UNFORMATTED_VALUE').execute().get('values', [])
    header = [str(h).strip() for h in rows[0]] if rows else HEADER
    col = {h: i for i, h in enumerate(header)}

    def get(row, name):
        i = col.get(name)
        return str(row[i]).strip() if i is not None and i < len(row) else ''
    found = [(n, r) for n, r in enumerate(rows[1:], start=2) if get(r, ID_HEADER)]
    return header, found, get


def tab_ids(sheets, sid):
    """업로드 탭의 상품번호 (분류 전이라 products.json에 없는 번호 포함)."""
    ensure_tab(sheets, sid)
    _, rows, get = read_tab(sheets, sid)
    return {get(r, ID_HEADER) for _, r in rows}


def cell(header, name, n):
    return f"'{UPLOAD_TAB}'!{col_letter(header.index(name) + 1)}{n}"


def thumb_formula(base, pid, v):
    return f'=IMAGE("{base}/{pid}/thumb.webp' + (f'?v={v}' if v else '') + '")'


def find_folder(drive):
    res = drive.files().list(
        q=f"name = '{UPLOAD_FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
        fields='files(id)').execute()['files']
    return res[0]['id'] if res else None


def list_photos(drive, folder):
    files, token = [], None
    while True:
        res = drive.files().list(
            q=f"'{folder}' in parents and mimeType contains 'image/' and trashed = false",
            fields='nextPageToken, files(id, name, createdTime)',
            pageSize=1000, pageToken=token).execute()
        files += res.get('files', [])
        token = res.get('nextPageToken')
        if not token:
            return files


def saved_ms(f):
    # 파일 이름의 13자리 숫자 = 저장 시각. 없으면 드라이브 업로드 시각으로 대신
    m = re.search(r'\d{13}', f['name'])
    if m:
        return int(m.group())
    return int(datetime.fromisoformat(f['createdTime'].replace('Z', '+00:00')).timestamp() * 1000)


def group(files):
    groups, last = [], None
    for f in sorted(files, key=saved_ms):
        t = saved_ms(f)
        if last is None or t - last >= GAP_MS:
            groups.append([])
        groups[-1].append(f)
        last = t
    return groups


def upload_group(r2, pid, files):
    def one(job):
        n, f = job
        thumb, detail = make_images(download(thread_drive(), f['id']))
        if n == 1:
            put(r2, f'{pid}/thumb.webp', thumb)
        put(r2, f'{pid}/{n}.webp', detail)
    with ThreadPoolExecutor(WORKERS) as ex:
        list(ex.map(one, enumerate(files, start=1)))


def process_new(sheets, drive, r2, sid, base, used):
    folder = find_folder(drive)
    if not folder:
        print(f"드라이브 '{UPLOAD_FOLDER}' 폴더 없음 (서비스 계정 공유 확인)")
        return 0, 0
    header, rows, get = read_tab(sheets, sid)
    done = {i for _, r in rows for i in get(r, '파일').split(',') if i}
    new = [f for f in list_photos(drive, folder) if f['id'] not in done]
    if not new:
        return 0, 0

    today = datetime.now(KST).date()
    added, failed = 0, 0
    for files in group(new):
        pid = next_id(today, used)
        try:
            upload_group(r2, pid, files)
        except Exception as e:  # 실패한 묶음은 다음 실행 때 다시 시도
            print(f'업로드 묶음 실패 ({files[0]["name"]} 외 {len(files) - 1}장): {e}')
            failed += 1
            continue
        used.add(pid)
        row = {ID_HEADER: "'" + pid, '썸네일': thumb_formula(base, pid, 0),
               '사진수': len(files), '파일': ','.join(f['id'] for f in files)}
        sheets.spreadsheets().values().append(
            spreadsheetId=sid, range=f"'{UPLOAD_TAB}'!A1", valueInputOption='USER_ENTERED',
            insertDataOption='OVERWRITE',
            body={'values': [[row.get(h, '') for h in header]]}).execute()
        added += 1
        print(f'업로드 → {pid} (사진 {len(files)}장, 분류 대기)')
    return added, failed


def r2_get(r2, key):
    return r2.get_object(Bucket=bucket(), Key=key)['Body'].read()


def bucket():
    return os.environ['R2_BUCKET'].strip()


def set_cover(r2, pid, n):
    """n번 사진을 1번 자리로 (서로 맞바꿈) + 썸네일 새로 만들기."""
    first, chosen = r2_get(r2, f'{pid}/1.webp'), r2_get(r2, f'{pid}/{n}.webp')
    put(r2, f'{pid}/1.webp', chosen)
    put(r2, f'{pid}/{n}.webp', first)
    img = Image.open(io.BytesIO(chosen)).convert('RGB')
    img.thumbnail((THUMB_WIDTH, THUMB_WIDTH * 4), Image.LANCZOS)
    put(r2, f'{pid}/thumb.webp', webp(img, THUMB_QUALITY))


def apply_covers(sheets, r2, sid, base):
    header, rows, get = read_tab(sheets, sid)
    updates = []
    for n, r in rows:
        want = get(r, '대표')
        if not want:
            continue
        pid, photos = get(r, ID_HEADER), int(float(get(r, '사진수') or 0))
        num = int(float(want)) if re.fullmatch(r'\d+(\.0)?', want) else 0
        if 2 <= num <= photos:
            try:
                set_cover(r2, pid, num)
            except Exception as e:  # 다음 실행 때 다시 시도 (칸 유지)
                print(f'{pid} 대표 교체 실패: {e}')
                continue
            v = int(float(get(r, '버전') or 0)) + 1
            updates += [{'range': cell(header, '버전', n), 'values': [[v]]},
                        {'range': cell(header, '썸네일', n), 'values': [[thumb_formula(base, pid, v)]]}]
            print(f'{pid} 대표 → {num}번 사진')
        elif num != 1:
            print(f'{pid} 대표 번호 확인 필요: {want} (1~{photos})')
        updates.append({'range': cell(header, '대표', n), 'values': [['']]})
    if updates:
        sheets.spreadsheets().values().batchUpdate(spreadsheetId=sid, body={
            'valueInputOption': 'USER_ENTERED', 'data': updates}).execute()


def drop_unsorted(sheets, r2, sid):
    """업로드 후 KEEP_UNSORTED_DAYS일 지나도 분류 없는 줄 → 줄 + R2 사진 삭제."""
    _, rows, get = read_tab(sheets, sid)
    cutoff = datetime.now(KST).date() - timedelta(days=KEEP_UNSORTED_DAYS)
    old = []
    for n, r in rows:
        pid = get(r, ID_HEADER)
        if get(r, '분류') or get(r, '상태'):
            continue
        try:
            day = date(2000 + int(pid[:2]), int(pid[2:4]), int(pid[4:6]))
        except ValueError:
            continue
        if day < cutoff:
            old.append((n, pid))
    if not old:
        return
    for _, pid in old:
        objs = r2.list_objects_v2(Bucket=bucket(), Prefix=f'{pid}/').get('Contents', [])
        if objs:
            r2.delete_objects(Bucket=bucket(), Delete={
                'Objects': [{'Key': o['Key']} for o in objs], 'Quiet': True})
    tid = next(s['properties']['sheetId'] for s in
               sheets.spreadsheets().get(spreadsheetId=sid).execute()['sheets']
               if s['properties']['title'] == UPLOAD_TAB)
    sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={'requests': [
        {'deleteDimension': {'range': {'sheetId': tid, 'dimension': 'ROWS',
                                       'startIndex': n - 1, 'endIndex': n}}}
        for n, _ in sorted(old, reverse=True)]}).execute()   # 아래 줄부터 지워야 번호가 안 밀림
    print(f'분류 없이 {KEEP_UNSORTED_DAYS}일 지난 상품 {len(old)}개 삭제: {", ".join(p for _, p in old)}')


def publish(sheets, sid, data):
    """업로드 탭 → products.json. 분류 있는 줄만 공개, 상품명·가격 수정도 매번 반영."""
    _, rows, get = read_tab(sheets, sid)
    ids = {get(r, ID_HEADER) for _, r in rows}
    data['items'] = [p for p in data['items'] if p['id'] not in ids]
    shown = 0
    for _, r in rows:
        pid = get(r, ID_HEADER)
        cat = CATS.get(get(r, '분류'))
        if not cat or '삭제됨' in get(r, '상태'):
            continue
        item = {
            'id': pid, 'date': f'20{pid[:2]}-{pid[2:4]}-{pid[4:6]}', 'cat1': cat[0], 'cat2': cat[1],
            'name': get(r, '상품명'), 'price': to_price(get(r, '가격')),
            'desc': get(r, '설명'), 'photos': int(float(get(r, '사진수') or 0))}
        v = int(float(get(r, '버전') or 0))
        if v:
            item['v'] = v   # 사진 교체 표시 (사이트가 새 사진을 받아오게)
        data['items'].append(item)
        shown += 1
    print(f'업로드 탭: 공개 {shown} / 분류 대기 {len(ids) - shown}')


def run(sheets, drive, r2, sid, data, used):
    added, failed = process_new(sheets, drive, r2, sid, data['base'], used)
    apply_covers(sheets, r2, sid, data['base'])
    drop_unsorted(sheets, r2, sid)
    publish(sheets, sid, data)
    return added, failed
