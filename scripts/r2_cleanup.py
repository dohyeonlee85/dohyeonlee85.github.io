"""1회용: shop01 초기화 후 R2에 남은 옛 사진 삭제. 기본은 미리보기 (R2_CLEAN_MODE=delete일 때만 삭제).

삭제 대상: 버킷 맨 위의 상품번호 폴더(예: 261025-57/) 중 LAST_DAY 이하 번호이고 products.json·업로드 탭에 없는 것.
shop03/·shop04/ 폴더는 이름 규칙에 안 맞아 대상에서 제외. 삭제 전후 파일 수를 출력해 확인.
"""
import json
import os
import re

from sync import JSON_PATH, google_services, r2_client
from upload import bucket, delete_r2, tab_ids

LAST_DAY = '261029'       # 이 날짜까지의 번호만 삭제 (이후 번호는 삭제 안 함)
ID_RE = re.compile(r'^(\d{6})-\d+$')
KEEP_PREFIXES = ('shop03/', 'shop04/')


def old_ids(r2, keep):
    found = []
    for page in r2.get_paginator('list_objects_v2').paginate(Bucket=bucket(), Delimiter='/'):
        for p in page.get('CommonPrefixes', []):
            name = p['Prefix'].rstrip('/')
            m = ID_RE.match(name)
            if m and m.group(1) <= LAST_DAY and name not in keep:
                found.append(name)
    return sorted(found)


def count(r2, prefix):
    return sum(len(page.get('Contents', [])) for page in
               r2.get_paginator('list_objects_v2').paginate(Bucket=bucket(), Prefix=prefix))


def main():
    sheets, _ = google_services()
    r2 = r2_client()
    with open(JSON_PATH, encoding='utf-8') as f:
        keep = {p['id'] for p in json.load(f)['items']}
    keep |= tab_ids(sheets, os.environ['SHEET_ID'].strip())

    ids = old_ids(r2, keep)
    print(f'유지 번호 {len(keep)}개, 삭제 대상 상품 {len(ids)}개')
    print(', '.join(ids))
    before = {p: count(r2, p) for p in KEEP_PREFIXES}
    print('shop03·04 파일 수:', before)

    if os.environ.get('R2_CLEAN_MODE', '').strip() != 'delete':
        print('미리보기만 실행 (삭제 안 함)')
        return
    for pid in ids:
        delete_r2(r2, pid)
    after = {p: count(r2, p) for p in KEEP_PREFIXES}
    print(f'삭제 완료: 상품 {len(ids)}개, 남은 대상 {len(old_ids(r2, keep))}개')
    print('shop03·04 파일 수:', after)
    if before != after:
        raise SystemExit('shop03·04 파일 수 변동 확인 필요')


if __name__ == '__main__':
    main()
