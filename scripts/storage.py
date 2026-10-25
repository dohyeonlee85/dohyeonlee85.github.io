"""R2 사용량 기록 → 시트 '용량' 탭 (드라이브는 Apps Script가 기록·알림).

R2 한도의 95% 이상이면 360일 지난 shop01 상품 삭제 (shop03·04 사진은 삭제 안 함): R2 사진 + products.json + 시트 '상태'에 '삭제됨'.
드라이브 원본은 Apps Script가 '삭제됨' 표시를 보고 지움.
"""
import json
import os
from datetime import date, datetime, timedelta, timezone

from upload import UPLOAD_TAB
from sync import ID_HEADER, JSON_PATH, col_letter, google_services, r2_client, save_json

R2_LIMIT = 30 * 1000 ** 3   # R2 사용 한도 30GB (무료 10GB + 유료 약 20GB, shop03·04 사진 포함, 2026-10-23)
CLEAN_PCT = 95              # 이 비율 이상이면 오래된 상품 삭제
KEEP_DAYS = 360             # 보관 기간
USAGE_TAB = '용량'
STATUS_HEADER = '상태'
KST = timezone(timedelta(hours=9))


def r2_usage(r2, bucket):
    total, keys = 0, []
    for page in r2.get_paginator('list_objects_v2').paginate(Bucket=bucket):
        for o in page.get('Contents', []):
            total += o['Size']
            keys.append(o['Key'])
    return total, keys


def write_usage(sheets, sid, used, pct):
    titles = [s['properties']['title'] for s in
              sheets.spreadsheets().get(spreadsheetId=sid).execute()['sheets']]
    if USAGE_TAB not in titles:
        sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={'requests': [
            {'addSheet': {'properties': {'title': USAGE_TAB}}}]}).execute()
    now = datetime.now(KST).strftime('%Y-%m-%d %H:%M')
    sheets.spreadsheets().values().update(
        spreadsheetId=sid, range=f"'{USAGE_TAB}'!A1:E1", valueInputOption='RAW',
        body={'values': [['항목', '사용(GB)', '한도(GB)', '비율(%)', '갱신']]}).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=sid, range=f"'{USAGE_TAB}'!A3:E3", valueInputOption='RAW',
        body={'values': [['R2', round(used / 1000 ** 3, 2), R2_LIMIT // 1000 ** 3, pct, now]]}).execute()


def mark_deleted(sheets, sid, pids, tab=None):
    tab = tab or sheets.spreadsheets().get(spreadsheetId=sid).execute()['sheets'][0]['properties']['title']
    rows = sheets.spreadsheets().values().get(
        spreadsheetId=sid, range=f"'{tab}'").execute().get('values', [])
    header = [str(h).strip() for h in rows[0]]
    if STATUS_HEADER not in header:
        header.append(STATUS_HEADER)
        sheets.spreadsheets().values().update(
            spreadsheetId=sid, range=f"'{tab}'!{col_letter(len(header))}1",
            valueInputOption='RAW', body={'values': [[STATUS_HEADER]]}).execute()
    id_i, st_i = header.index(ID_HEADER), header.index(STATUS_HEADER)
    st_col = col_letter(st_i + 1)
    updates = []
    for r, row in enumerate(rows[1:], start=2):
        pid = row[id_i].strip() if id_i < len(row) else ''
        if pid not in pids:
            continue
        st = row[st_i].strip() if st_i < len(row) else ''
        if '삭제됨' not in st:
            updates.append({'range': f"'{tab}'!{st_col}{r}",
                            'values': [[st + '·삭제됨' if st else '삭제됨']]})
    if updates:
        sheets.spreadsheets().values().batchUpdate(spreadsheetId=sid, body={
            'valueInputOption': 'RAW', 'data': updates}).execute()


def main():
    sid = os.environ['SHEET_ID'].strip()
    bucket = os.environ['R2_BUCKET'].strip()
    sheets, _ = google_services()
    r2 = r2_client()

    used, keys = r2_usage(r2, bucket)
    pct = round(used / R2_LIMIT * 100, 1)
    print(f'R2 사용량: {used / 1000 ** 3:.2f}GB ({pct}%)')

    if pct >= CLEAN_PCT:
        with open(JSON_PATH, encoding='utf-8') as f:
            data = json.load(f)
        cutoff = datetime.now(KST).date() - timedelta(days=KEEP_DAYS)
        old = {p['id'] for p in data['items'] if date.fromisoformat(p['date']) < cutoff}
        if old:
            doomed = [k for k in keys if k.split('/')[0] in old]
            for i in range(0, len(doomed), 1000):
                r2.delete_objects(Bucket=bucket, Delete={
                    'Objects': [{'Key': k} for k in doomed[i:i + 1000]], 'Quiet': True})
            data['items'] = [p for p in data['items'] if p['id'] not in old]
            save_json(data)
            mark_deleted(sheets, sid, old)
            mark_deleted(sheets, sid, old, UPLOAD_TAB)   # 사진 일괄 업로드 상품
            used, _ = r2_usage(r2, bucket)
            pct = round(used / R2_LIMIT * 100, 1)
            print(f'{KEEP_DAYS}일 지난 상품 {len(old)}개 삭제 → R2 {pct}%')
        else:
            print(f'{KEEP_DAYS}일 지난 상품 없음, 삭제 안 함')

    write_usage(sheets, sid, used, pct)


if __name__ == '__main__':
    main()
