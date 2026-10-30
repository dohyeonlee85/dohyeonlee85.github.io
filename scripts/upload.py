"""드라이브 업로드 폴더 사진 → 상품별 묶기 → WebP 변환 → R2 업로드 → 시트 업로드 탭.

사이트별로 폴더·탭을 따로 씀 (SITES):
  shop01: '업로드' 폴더 → '업로드' 탭 → products.json
  shop03·04: '업로드03'·'업로드04' 폴더 → 같은 이름 탭 → 각 Firebase(Firestore) 상품으로 등록
묶기: 사진 파일 이름 = 저장 시각(1000분의 1초). 앞 사진과 GAP_MS 이상 벌어지면 다음 상품.
공개: '분류'를 고른 줄만 사이트에 반영. 분류를 지우면 사이트에서 내림.
대표: '대표' 칸에 사진 번호 → 그 사진을 1번·썸네일로, '역순' → 전체 순서 뒤집기. 처리 후 칸 비움.
  shop03·04: 사진을 처음부터 파일 이름 역순으로 올림. '오름차순' → 파일 이름 순서로 뒤집기 ('역순'은 칸만 비움).
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
import firestore

GAP_MS = 1000             # 이 간격(1초) 이상 벌어지면 다음 상품
WORKERS = 4               # 사진 동시 처리 수
KEEP_UNSORTED_DAYS = 7    # 분류 없는 상품 보관 일수
MAX_ROWS = 5000
KST = timezone(timedelta(hours=9))
HEADER = [ID_HEADER, '썸네일', '사진수', '분류', '상품명', '가격', '설명', '상태', '파일', '대표', '버전']
SYNCED = '반영'           # Firebase 사이트: 마지막으로 사이트에 보낸 값 (자동 기록, 손대지 않음)
CATS = {
    '여성-상의': ('clothes-women', 'top'), '여성-하의': ('clothes-women', 'bottom'),
    '여성-아우터': ('clothes-women', 'outer'), '여성-기타': ('clothes-women', 'etc'),
    '남성-상의': ('clothes-men', 'top'), '남성-하의': ('clothes-men', 'bottom'),
    '남성-아우터': ('clothes-men', 'outer'), '남성-기타': ('clothes-men', 'etc'),
    '신발-슬리퍼': ('shoes', 'slippers'), '신발-부츠': ('shoes', 'boots'),
    '가방': ('bags', ''),
    # 옛 분류값: shoes 탭(all)에만 표시 → 신발-슬리퍼/부츠로 바꾼 뒤 삭제 가능
    '여성-신발': ('shoes', ''), '남성-신발': ('shoes', ''),
}
SITES = [
    {'name': 'shop01', 'folder': '업로드', 'tab': '업로드', 'prefix': ''},
    {'name': 'shop03', 'folder': '업로드03', 'tab': '업로드03', 'prefix': 'shop03/',
     'project': 'shop03-8e79a', 'cat_tab': '분류03',
     'cats': [('bag', ''), ('bag', 'Hermè'), ('bag', '𝒸𝒽𝒶'), ('bag', '𝑳𝐕'), ('bag', 'Y𝑳'), ('bag', 'ᗺB'),
              ('bag', '𝐏 𝐑 𝐀'), ('bag', '🏛️𝗖𝗘𝗟'), ('bag', '𝐃𝐢𝐨'), ('bag', 'miu'), ('bag', 'Etc.'),
              ('bag-charm', ''), ('bag-keyring', ''), ('sunglasses', ''), ('muffler', '')]},
    {'name': 'shop04', 'folder': '업로드04', 'tab': '업로드04', 'prefix': 'shop04/',
     'project': 'shop04-ab6c5', 'cat_tab': '분류04',
     'cats': [('Jewelry', 'Bracelet'), ('Jewelry', 'Necklace'), ('Jewelry', 'Earrings'),
              ('Jewelry', 'Ring'), ('Jewelry', 'Jewelry Accessories'),
              ('Shoes', 'Boots'), ('Shoes', 'Flats & Loafers'), ('Shoes', 'Loafers'), ('Shoes', 'Mules'),
              ('Shoes', 'Slippers & Slides'), ('Shoes', 'Sneakers'),
              ('Accessories', 'belt'), ('Accessories', 'cap'), ('Accessories', 'muffler'),
              ('Watches', ''), ('clothes_women', 'outer'), ('clothes_men', '')]},
]
UPLOAD_TAB = SITES[0]['tab']   # storage.py에서 사용
CAT_SEP = ' / '                # 분류 표시: '대분류 / 소분류'

_local = threading.local()


def thread_drive():
    # 드라이브 연결은 스레드끼리 공유 불가 → 스레드마다 하나씩
    if not hasattr(_local, 'drive'):
        _local.drive = google_services()[1]
    return _local.drive


def is_fb(site):
    return 'project' in site


def tab_props(sheets, sid):
    return {s['properties']['title']: s['properties'] for s in
            sheets.spreadsheets().get(spreadsheetId=sid).execute()['sheets']}


def ensure_cat_tab(sheets, sid, site, tabs):
    """Firebase 사이트 분류 목록 탭 (A 대분류, B 소분류 → C 드롭다운 표시값). 없으면 기본값으로 만듦."""
    name = site['cat_tab']
    if name not in tabs:
        sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={'requests': [
            {'addSheet': {'properties': {'title': name, 'gridProperties': {'frozenRowCount': 1}}}}]}).execute()
        rows = [['대분류', '소분류', '드롭다운 (자동)']] + [[g, c] for g, c in site['cats']]
        sheets.spreadsheets().values().update(
            spreadsheetId=sid, range=f"'{name}'!A1", valueInputOption='RAW',
            body={'values': rows}).execute()
        sheets.spreadsheets().values().update(
            spreadsheetId=sid, range=f"'{name}'!C2", valueInputOption='USER_ENTERED',
            body={'values': [[f'=ARRAYFORMULA(IF(A2:A="","",IF(B2:B="",A2:A,A2:A&"{CAT_SEP}"&B2:B)))']]}).execute()
    return f"='{name}'!C2:C"


def ensure_tab(sheets, sid, site):
    tabs = tab_props(sheets, sid)
    header_want = HEADER + ([SYNCED] if is_fb(site) else [])
    cat_range = ensure_cat_tab(sheets, sid, site, tabs) if is_fb(site) else None
    tab = site['tab']
    if tab in tabs:
        # 나중에 추가된 열(대표·버전 등)은 맨 오른쪽에 이어 붙임
        first = sheets.spreadsheets().values().get(
            spreadsheetId=sid, range=f"'{tab}'!1:1").execute().get('values', [[]])
        header = [str(h).strip() for h in (first[0] if first else [])]
        missing = [h for h in header_want if h not in header]
        if missing:
            props = tabs[tab]
            short = len(header) + len(missing) - props['gridProperties']['columnCount']
            if short > 0:   # 시트 칸 수가 모자라면 먼저 늘림
                sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={'requests': [
                    {'appendDimension': {'sheetId': props['sheetId'], 'dimension': 'COLUMNS',
                                         'length': short}}]}).execute()
            sheets.spreadsheets().values().update(
                spreadsheetId=sid, range=f"'{tab}'!{col_letter(len(header) + 1)}1",
                valueInputOption='RAW', body={'values': [missing]}).execute()
        return
    res = sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={'requests': [
        {'addSheet': {'properties': {'title': tab, 'gridProperties': {
            'rowCount': MAX_ROWS, 'columnCount': len(header_want), 'frozenRowCount': 1}}}}]}).execute()
    tid = res['replies'][0]['addSheet']['properties']['sheetId']
    cat_col = HEADER.index('분류')
    if cat_range:   # 분류 탭 C열을 그대로 드롭다운으로 (분류 탭에 줄 추가 → 바로 선택 가능)
        rule = {'condition': {'type': 'ONE_OF_RANGE', 'values': [{'userEnteredValue': cat_range}]},
                'showCustomUi': True, 'strict': True}
    else:
        rule = {'condition': {'type': 'ONE_OF_LIST', 'values': [{'userEnteredValue': c} for c in CATS]},
                'showCustomUi': True, 'strict': True}
    sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={'requests': [
        {'setDataValidation': {
            'range': {'sheetId': tid, 'startRowIndex': 1, 'endRowIndex': MAX_ROWS,
                      'startColumnIndex': cat_col, 'endColumnIndex': cat_col + 1},
            'rule': rule}},
        {'updateDimensionProperties': {   # 썸네일이 잘 보이게 행 높이·열 너비
            'range': {'sheetId': tid, 'dimension': 'ROWS', 'startIndex': 1, 'endIndex': MAX_ROWS},
            'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
        {'updateDimensionProperties': {
            'range': {'sheetId': tid, 'dimension': 'COLUMNS', 'startIndex': 1, 'endIndex': 2},
            'properties': {'pixelSize': 100}, 'fields': 'pixelSize'}},
    ]}).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=sid, range=f"'{tab}'!A1", valueInputOption='RAW',
        body={'values': [header_want]}).execute()


def read_tab(sheets, sid, site):
    """(header, [(시트 행 번호, 행)], get) — 상품번호 있는 행만."""
    rows = sheets.spreadsheets().values().get(
        spreadsheetId=sid, range=f"'{site['tab']}'",
        valueRenderOption='UNFORMATTED_VALUE').execute().get('values', [])
    header = [str(h).strip() for h in rows[0]] if rows else HEADER
    col = {h: i for i, h in enumerate(header)}

    def get(row, name):
        i = col.get(name)
        return str(row[i]).strip() if i is not None and i < len(row) else ''
    found = [(n, r) for n, r in enumerate(rows[1:], start=2) if get(r, ID_HEADER)]
    return header, found, get


def tab_ids(sheets, sid, site=SITES[0]):
    """업로드 탭의 상품번호 (분류 전이라 사이트에 없는 번호 포함)."""
    ensure_tab(sheets, sid, site)
    _, rows, get = read_tab(sheets, sid, site)
    return {get(r, ID_HEADER) for _, r in rows}


def cell(site, header, name, n):
    return f"'{site['tab']}'!{col_letter(header.index(name) + 1)}{n}"


def photo_url(base, site, pid, name, v):
    return f"{base}/{site['prefix']}{pid}/{name}" + (f'?v={v}' if v else '')


def thumb_formula(base, site, pid, v):
    return f'=IMAGE("{photo_url(base, site, pid, "thumb.webp", v)}")'


def find_folder(drive, name):
    res = drive.files().list(
        q=f"name = '{name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
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


def upload_group(r2, key, files):
    def one(job):
        n, f = job
        thumb, detail = make_images(download(thread_drive(), f['id']))
        if n == 1:
            put(r2, f'{key}/thumb.webp', thumb)
        put(r2, f'{key}/{n}.webp', detail)
    with ThreadPoolExecutor(WORKERS) as ex:
        list(ex.map(one, enumerate(files, start=1)))


def process_new(sheets, drive, r2, sid, base, used, site):
    folder = find_folder(drive, site['folder'])
    if not folder:
        print(f"드라이브 '{site['folder']}' 폴더 없음 (서비스 계정 공유 확인)")
        return 0, 0
    header, rows, get = read_tab(sheets, sid, site)
    done = {i for _, r in rows for i in get(r, '파일').split(',') if i}
    new = [f for f in list_photos(drive, folder) if f['id'] not in done]
    if not new:
        return 0, 0

    today = datetime.now(KST).date()
    added, failed = 0, 0
    for files in group(new):
        pid = next_id(today, used)
        try:
            # shop03·04: 기본 역순 (파일 이름 마지막 사진 → 1번)
            upload_group(r2, site['prefix'] + pid, files[::-1] if is_fb(site) else files)
        except Exception as e:  # 실패한 묶음은 다음 실행 때 다시 시도
            print(f'{site["name"]} 업로드 묶음 실패 ({files[0]["name"]} 외 {len(files) - 1}장): {e}')
            failed += 1
            continue
        used.add(pid)
        row = {ID_HEADER: "'" + pid, '썸네일': thumb_formula(base, site, pid, 0),
               '사진수': len(files), '파일': ','.join(f['id'] for f in files)}
        sheets.spreadsheets().values().append(
            spreadsheetId=sid, range=f"'{site['tab']}'!A1", valueInputOption='USER_ENTERED',
            insertDataOption='OVERWRITE',
            body={'values': [[row.get(h, '') for h in header]]}).execute()
        added += 1
        print(f'{site["name"]} 업로드 → {pid} (사진 {len(files)}장, 분류 대기)')
    return added, failed


def r2_get(r2, key):
    return r2.get_object(Bucket=bucket(), Key=key)['Body'].read()


def bucket():
    return os.environ['R2_BUCKET'].strip()


def new_thumb(r2, key, detail):
    img = Image.open(io.BytesIO(detail)).convert('RGB')
    img.thumbnail((THUMB_WIDTH, THUMB_WIDTH * 4), Image.LANCZOS)
    put(r2, f'{key}/thumb.webp', webp(img, THUMB_QUALITY))


def set_cover(r2, key, n):
    """n번 사진을 1번 자리로 (서로 맞바꿈) + 썸네일 새로 만들기."""
    first, chosen = r2_get(r2, f'{key}/1.webp'), r2_get(r2, f'{key}/{n}.webp')
    put(r2, f'{key}/1.webp', chosen)
    put(r2, f'{key}/{n}.webp', first)
    new_thumb(r2, key, chosen)


def reverse_photos(r2, key, photos):
    """사진 순서 전체 뒤집기 (마지막 사진 → 1번) + 썸네일 새로 만들기."""
    imgs = [r2_get(r2, f'{key}/{k}.webp') for k in range(1, photos + 1)]
    for k, data in enumerate(reversed(imgs), start=1):
        put(r2, f'{key}/{k}.webp', data)
    new_thumb(r2, key, imgs[-1])


def apply_covers(sheets, r2, sid, base, site):
    """대표 칸: 숫자 = 그 사진을 1번·썸네일로, 뒤집기 값('역순', shop03·04는 '오름차순') = 전체 순서 뒤집기.

    처리 후 칸 비움. 시트 기록은 뒤집기 1개마다 바로 함 (오래 걸려도 연결 안 끊기게, 실패해도 다시 안 뒤집게).
    """
    header, rows, get = read_tab(sheets, sid, site)
    flip = '오름차순' if is_fb(site) else '역순'
    updates = []

    def flush():
        if updates:
            sheets.spreadsheets().values().batchUpdate(spreadsheetId=sid, body={
                'valueInputOption': 'USER_ENTERED', 'data': updates}).execute()
            updates.clear()
    for n, r in rows:
        want = get(r, '대표')
        if not want:
            continue
        pid, photos = get(r, ID_HEADER), int(float(get(r, '사진수') or 0))
        key = site['prefix'] + pid
        num = int(float(want)) if re.fullmatch(r'\d+(\.0)?', want) else 0
        if want == flip and photos >= 2:
            job, done = (lambda: reverse_photos(r2, key, photos)), '전체 순서 뒤집기'
        elif is_fb(site) and want == '역순':   # 이미 기본값(역순) → 칸만 비움 (썸네일 새로 읽게 버전 +1)
            job, done = None, '역순(기본값) 칸 정리'
        elif 2 <= num <= photos:
            job, done = (lambda: set_cover(r2, key, num)), f'대표 → {num}번 사진'
        else:
            if num != 1:
                print(f'{pid} 대표 칸 확인 필요: {want} (1~{photos} 또는 {flip})')
            updates.append({'range': cell(site, header, '대표', n), 'values': [['']]})
            continue
        if job:
            try:
                job()
            except Exception as e:  # 다음 실행 때 다시 시도 (칸 유지)
                print(f'{pid} 사진 순서 변경 실패: {e}')
                continue
        v = int(float(get(r, '버전') or 0)) + 1
        updates += [{'range': cell(site, header, '버전', n), 'values': [[v]]},
                    {'range': cell(site, header, '썸네일', n), 'values': [[thumb_formula(base, site, pid, v)]]},
                    {'range': cell(site, header, '대표', n), 'values': [['']]}]
        if job:
            flush()
        print(f'{site["name"]} {pid} {done}')
    flush()


def delete_r2(r2, key):
    objs = r2.list_objects_v2(Bucket=bucket(), Prefix=f'{key}/').get('Contents', [])
    if objs:
        r2.delete_objects(Bucket=bucket(), Delete={
            'Objects': [{'Key': o['Key']} for o in objs], 'Quiet': True})


def delete_rows(sheets, sid, site, nums):
    tid = tab_props(sheets, sid)[site['tab']]['sheetId']
    sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={'requests': [
        {'deleteDimension': {'range': {'sheetId': tid, 'dimension': 'ROWS',
                                       'startIndex': n - 1, 'endIndex': n}}}
        for n in sorted(nums, reverse=True)]}).execute()   # 아래 줄부터 지워야 번호가 안 밀림


def drop_unsorted(sheets, r2, sid, site):
    """업로드 후 KEEP_UNSORTED_DAYS일 지나도 분류 없는 줄 → 줄 + R2 사진 삭제."""
    _, rows, get = read_tab(sheets, sid, site)
    cutoff = datetime.now(KST).date() - timedelta(days=KEEP_UNSORTED_DAYS)
    old = []
    for n, r in rows:
        pid = get(r, ID_HEADER)
        if get(r, '분류') or get(r, '상태') or get(r, SYNCED):
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
        delete_r2(r2, site['prefix'] + pid)
    delete_rows(sheets, sid, site, [n for n, _ in old])
    print(f'{site["name"]} 분류 없이 {KEEP_UNSORTED_DAYS}일 지난 상품 {len(old)}개 삭제: {", ".join(p for _, p in old)}')


def publish(sheets, sid, data, site):
    """업로드 탭 → products.json. 분류 있는 줄만 공개, 상품명·가격 수정도 매번 반영."""
    _, rows, get = read_tab(sheets, sid, site)
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


def publish_fb(sheets, r2, sid, base, site, fs, daily):
    """업로드 탭 → Firestore. 분류·상품명·가격·대표 사진이 바뀐 줄만 보냄 (admin에서 고친 다른 값은 유지).

    '반영' 칸 = 마지막으로 보낸 값. 분류를 지우면 사이트 상품 삭제.
    daily(매일 03:00 실행): admin에서 지운 상품 → 상태 '삭제됨' + R2 사진 삭제.
    """
    header, rows, get = read_tab(sheets, sid, site)
    project = site['project']
    existing = firestore.doc_ids(fs, project) if daily else None
    updates, gone = [], []
    shown, waiting = 0, 0
    for n, r in rows:
        pid = get(r, ID_HEADER)
        synced = get(r, SYNCED)
        if '삭제됨' in get(r, '상태'):
            continue
        if daily and synced and pid not in existing:   # admin에서 삭제함
            delete_r2(r2, site['prefix'] + pid)
            gone.append(pid)
            updates += [{'range': cell(site, header, '상태', n), 'values': [['삭제됨']]},
                        {'range': cell(site, header, SYNCED, n), 'values': [['']]}]
            continue
        cat = get(r, '분류')
        if not cat:
            if synced:   # 분류를 지움 → 사이트에서 내림
                firestore.delete(fs, project, pid)
                updates.append({'range': cell(site, header, SYNCED, n), 'values': [['']]})
                print(f'{site["name"]} {pid} 사이트에서 내림')
            waiting += 1
            continue
        g, _, c = cat.partition(CAT_SEP)
        photos = int(float(get(r, '사진수') or 0))
        v = int(float(get(r, '버전') or 0))
        name, price = get(r, '상품명'), to_price(get(r, '가격'))
        sig = f'{cat}|{name}|{price}|{v}'
        shown += 1
        if sig == synced:
            continue
        fields = {'group': g.strip(), 'category': c.strip(), 'name': name, 'price': price,
                  'T': [photo_url(base, site, pid, f'{k}.webp', v) for k in range(1, photos + 1)],
                  'TP': [''] * photos}
        if not synced:   # 처음 등록: admin이 쓰는 나머지 값도 기본값으로
            fields.update({'code': '', 'oldPrice': 0, 'pop': 0, 'size': '', 'visible': True,
                           'isNew': False, 'ss': False, 'fw': False, 'D': [], 'DP': [],
                           'createdAt': int(datetime.now(timezone.utc).timestamp() * 1000)})
        try:
            ok = firestore.upsert(fs, project, pid, fields, create=not synced)
        except Exception as e:   # 다음 실행 때 다시 시도
            print(f'{site["name"]} {pid} 사이트 반영 실패: {e}')
            continue
        if not ok:   # admin에서 삭제한 상품
            delete_r2(r2, site['prefix'] + pid)
            gone.append(pid)
            shown -= 1
            updates += [{'range': cell(site, header, '상태', n), 'values': [['삭제됨']]},
                        {'range': cell(site, header, SYNCED, n), 'values': [['']]}]
            continue
        updates.append({'range': cell(site, header, SYNCED, n), 'values': [[sig]]})
        print(f'{site["name"]} {pid} 사이트 반영 ({"새 상품" if not synced else "수정"})')
    if updates:
        sheets.spreadsheets().values().batchUpdate(spreadsheetId=sid, body={
            'valueInputOption': 'RAW', 'data': updates}).execute()
    if gone:
        print(f'{site["name"]} admin에서 삭제된 상품 {len(gone)}개 정리: {", ".join(gone)}')
    print(f'{site["tab"]} 탭: 공개 {shown} / 분류 대기 {waiting}')


def run(sheets, drive, r2, sid, data, used):
    shop01 = SITES[0]
    added, failed = process_new(sheets, drive, r2, sid, data['base'], used, shop01)
    apply_covers(sheets, r2, sid, data['base'], shop01)
    drop_unsorted(sheets, r2, sid, shop01)
    publish(sheets, sid, data, shop01)

    daily = os.environ.get('GITHUB_EVENT_NAME') == 'schedule'
    fs = None
    for site in SITES[1:]:
        try:   # 한 사이트 문제가 다른 사이트를 막지 않게
            sheets, drive = google_services()   # 사이트마다 새 연결 (오래 쉰 연결 끊김 방지)
            fs = fs or firestore.client()
            site_used = tab_ids(sheets, sid, site)
            a, f = process_new(sheets, drive, r2, sid, data['base'], site_used, site)
            apply_covers(sheets, r2, sid, data['base'], site)
            drop_unsorted(sheets, r2, sid, site)
            publish_fb(sheets, r2, sid, data['base'], site, fs, daily)
            added, failed = added + a, failed + f
        except Exception as e:
            print(f'{site["name"]} 처리 실패: {e}')
            failed += 1
    return added, failed
