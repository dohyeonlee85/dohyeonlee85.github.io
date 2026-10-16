"""시트 새 상품 → 드라이브 사진 WebP 변환 → R2 업로드 → products.json 갱신.

처리 표시: 시트에 '상품번호' 열을 만들고, 처리한 행에 번호를 적음.
번호가 비어 있는 행만 새 상품으로 봄.
"""
import io
import json
import os
import re
import sys
from datetime import datetime, timedelta

import boto3
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()

JSON_PATH = 'products.json'
ID_HEADER = '상품번호'
THUMB_WIDTH = 480      # 목록 썸네일 가로 px
DETAIL_MAX = 1280      # 상세 사진 긴 변 px
THUMB_QUALITY = 75
DETAIL_QUALITY = 82
CATS1 = {'clothes-women', 'clothes-men'}
CATS2 = {'top', 'bottom', 'outer', 'shoes', 'etc'}


def google_services():
    info = json.loads(os.environ['GOOGLE_SA_KEY'])
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=['https://www.googleapis.com/auth/spreadsheets',
                      'https://www.googleapis.com/auth/drive.readonly'])
    return (build('sheets', 'v4', credentials=creds, cache_discovery=False),
            build('drive', 'v3', credentials=creds, cache_discovery=False))


def r2_client():
    # 계정 ID: 공백·주소가 섞여 들어가도 32자리 ID만 뽑아 씀
    found = re.search(r'[0-9a-f]{32}', os.environ['R2_ACCOUNT_ID'].lower())
    if not found:
        sys.exit('R2_ACCOUNT_ID 값 확인 필요 (32자리 영문·숫자)')
    return boto3.client(
        's3',
        endpoint_url=f"https://{found.group()}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'].strip(),
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'].strip(),
        region_name='auto')


def col_letter(n):
    s = ''
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def serial_to_date(v):
    # 시트 날짜 숫자(1899-12-30 기준 일수, 시트 시간대 기준) → 날짜
    return (datetime(1899, 12, 30) + timedelta(days=float(v))).date()


def to_price(v):
    if isinstance(v, (int, float)):
        return int(v)
    digits = re.sub(r'[^0-9]', '', str(v or ''))
    return int(digits) if digits else 0


def drive_ids(cell):
    return re.findall(r'id=([A-Za-z0-9_-]+)', str(cell or ''))


def download(drive, file_id):
    buf = io.BytesIO()
    req = drive.files().get_media(fileId=file_id)
    dl = MediaIoBaseDownload(buf, req)
    done = False
    while not done:
        _, done = dl.next_chunk()
    buf.seek(0)
    return buf


def webp(img, quality):
    out = io.BytesIO()
    img.save(out, 'WEBP', quality=quality, method=6)
    return out.getvalue()


def make_images(raw):
    img = ImageOps.exif_transpose(Image.open(raw)).convert('RGB')
    detail = img.copy()
    detail.thumbnail((DETAIL_MAX, DETAIL_MAX), Image.LANCZOS)
    thumb = img.copy()
    thumb.thumbnail((THUMB_WIDTH, THUMB_WIDTH * 4), Image.LANCZOS)
    return webp(thumb, THUMB_QUALITY), webp(detail, DETAIL_QUALITY)


def put(r2, key, data):
    r2.put_object(Bucket=os.environ['R2_BUCKET'].strip(), Key=key, Body=data,
                  ContentType='image/webp',
                  CacheControl='public, max-age=31536000, immutable')


def next_id(day, used):
    prefix = day.strftime('%y%m%d')
    n = 1
    while f'{prefix}-{n:02d}' in used:
        n += 1
    return f'{prefix}-{n:02d}'


def main():
    sheet_id = os.environ['SHEET_ID'].strip()
    sheets, drive = google_services()
    r2 = r2_client()
    # 값 자체는 숨기고 길이만 표시 (정상: 32 / 64 / True)
    print('키 점검: Access Key ID', len(os.environ['R2_ACCESS_KEY_ID'].strip()), '자리,',
          'Secret', len(os.environ['R2_SECRET_ACCESS_KEY'].strip()), '자리,',
          '버킷 이름 shop-images 일치', os.environ['R2_BUCKET'].strip() == 'shop-images')

    tab = sheets.spreadsheets().get(spreadsheetId=sheet_id).execute()['sheets'][0]['properties']['title']
    rows = sheets.spreadsheets().values().get(
        spreadsheetId=sheet_id, range=f"'{tab}'",
        valueRenderOption='UNFORMATTED_VALUE').execute().get('values', [])
    if not rows:
        print('시트 비어 있음')
        return

    header = [str(h).strip() for h in rows[0]]
    if ID_HEADER not in header:
        header.append(ID_HEADER)
        sheets.spreadsheets().values().update(
            spreadsheetId=sheet_id, range=f"'{tab}'!{col_letter(len(header))}1",
            valueInputOption='RAW', body={'values': [[ID_HEADER]]}).execute()
    col = {h: i for i, h in enumerate(header)}
    id_col = col_letter(col[ID_HEADER] + 1)

    with open(JSON_PATH, encoding='utf-8') as f:
        data = json.load(f)
    used = {p['id'] for p in data['items']}

    def get(row, name):
        i = col.get(name)
        return row[i] if i is not None and i < len(row) else ''

    added, failed = 0, 0
    for r, row in enumerate(rows[1:], start=2):
        if str(get(row, ID_HEADER)).strip():
            continue
        ids = drive_ids(get(row, '사진'))
        cat1 = str(get(row, '대분류')).strip()
        cat2 = str(get(row, '소분류')).strip()
        if not ids or cat1 not in CATS1 or cat2 not in CATS2:
            print(f'{r}행 건너뜀: 사진/분류 확인 필요')
            failed += 1
            continue

        day = serial_to_date(get(row, '타임스탬프'))
        pid = next_id(day, used)
        try:
            for n, fid in enumerate(ids, start=1):
                thumb, detail = make_images(download(drive, fid))
                if n == 1:
                    put(r2, f'{pid}/thumb.webp', thumb)
                put(r2, f'{pid}/{n}.webp', detail)
        except Exception as e:  # 한 상품 실패해도 나머지는 계속
            print(f'{r}행 실패: {e}')
            failed += 1
            continue

        data['items'].append({
            'id': pid, 'date': day.isoformat(), 'cat1': cat1, 'cat2': cat2,
            'name': str(get(row, '상품명')).strip(), 'price': to_price(get(row, '가격')),
            'desc': str(get(row, '설명')).strip(), 'photos': len(ids)})
        used.add(pid)
        sheets.spreadsheets().values().update(
            spreadsheetId=sheet_id, range=f"'{tab}'!{id_col}{r}",
            valueInputOption='RAW', body={'values': [[pid]]}).execute()
        added += 1
        print(f'{r}행 → {pid} (사진 {len(ids)}장)')

    data['items'].sort(key=lambda p: p['id'], reverse=True)
    with open(JSON_PATH, 'w', encoding='utf-8') as f:
        f.write('{\n"base": ' + json.dumps(data['base']) + ',\n"items": [\n')
        f.write(',\n'.join(json.dumps(p, ensure_ascii=False) for p in data['items']))
        f.write('\n]\n}\n')

    print(f'완료: 추가 {added}, 실패 {failed}')
    if failed:
        sys.exit(1)  # 실패 시 Actions가 빨간 표시 + 이메일 알림


if __name__ == '__main__':
    main()
