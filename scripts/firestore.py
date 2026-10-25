"""shop03·04 Firebase(Firestore) 상품 쓰기 — 구글 서비스 계정(GOOGLE_SA_KEY)으로 접속.

필요: 각 Firebase 프로젝트 IAM에 서비스 계정 shop-sync를 'Cloud Datastore 사용자' 역할로 추가.
"""
import json
import os

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

COLLECTION = 'products'   # config.js collection 값과 같게


def client():
    info = json.loads(os.environ['GOOGLE_SA_KEY'])
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=['https://www.googleapis.com/auth/datastore'])
    return build('firestore', 'v1', credentials=creds, cache_discovery=False)


def docs(fs):
    return fs.projects().databases().documents()


def doc_name(project, pid):
    return f'projects/{project}/databases/(default)/documents/{COLLECTION}/{pid}'


def value(v):
    if isinstance(v, bool):
        return {'booleanValue': v}
    if isinstance(v, int):
        return {'integerValue': str(v)}
    if isinstance(v, list):
        return {'arrayValue': {'values': [value(x) for x in v]}}
    return {'stringValue': str(v)}


def upsert(fs, project, pid, fields, create):
    """create=True: 문서 새로 만듦. False: 주어진 칸만 고침 (admin에서 바꾼 다른 칸은 그대로).

    고칠 문서가 없으면(admin에서 삭제) False.
    """
    body = {'fields': {k: value(v) for k, v in fields.items()}}
    kw = {} if create else {'updateMask_fieldPaths': list(fields), 'currentDocument_exists': True}
    try:
        docs(fs).patch(name=doc_name(project, pid), body=body, **kw).execute()
    except HttpError as e:
        if not create and e.resp.status == 404:
            return False
        raise
    return True


def delete(fs, project, pid):
    try:
        docs(fs).delete(name=doc_name(project, pid)).execute()
    except HttpError as e:
        if e.resp.status != 404:
            raise


def doc_ids(fs, project):
    """컬렉션의 모든 문서 번호 (admin에서 지운 상품 확인용, 하루 1번)."""
    ids, token = set(), None
    while True:
        res = docs(fs).listDocuments(parent=f'projects/{project}/databases/(default)/documents',
                            collectionId=COLLECTION, pageSize=300, pageToken=token,
                            mask_fieldPaths=['code']).execute()
        ids |= {d['name'].rsplit('/', 1)[1] for d in res.get('documents', [])}
        token = res.get('nextPageToken')
        if not token:
            return ids
