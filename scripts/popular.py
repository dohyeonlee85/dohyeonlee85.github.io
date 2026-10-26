"""인기순: GA4 최근 30일 상품 조회수(view_item) → products.json 각 상품 pop 값.

조회 0인 상품은 pop 생략 (용량 절약). GA4 연결 실패해도 상품 동기화에는 영향 없음.
"""
import json
import os

from google.oauth2 import service_account
from googleapiclient.discovery import build

from sync import JSON_PATH, save_json

DAYS = 30   # 조회수 집계 기간 (일)


def main():
    info = json.loads(os.environ['GOOGLE_SA_KEY'])
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=['https://www.googleapis.com/auth/analytics.readonly'])
    ga = build('analyticsdata', 'v1beta', credentials=creds, cache_discovery=False)
    prop = os.environ['GA4_PROPERTY_ID'].strip()
    res = ga.properties().runReport(property=f'properties/{prop}', body={
        'dateRanges': [{'startDate': f'{DAYS}daysAgo', 'endDate': 'today'}],
        'dimensions': [{'name': 'itemId'}],
        'metrics': [{'name': 'itemsViewed'}],
        'limit': 10000,
    }).execute()
    views = {r['dimensionValues'][0]['value']: int(r['metricValues'][0]['value'])
             for r in res.get('rows', [])}

    with open(JSON_PATH, encoding='utf-8') as f:
        data = json.load(f)
    for p in data['items']:
        n = views.get(p['id'], 0)
        if n:
            p['pop'] = n
        else:
            p.pop('pop', None)
    save_json(data)
    print(f'인기순 반영: 조회 있는 상품 {sum(1 for p in data["items"] if p.get("pop"))}개')


if __name__ == '__main__':
    main()
