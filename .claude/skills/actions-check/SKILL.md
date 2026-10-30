---
name: actions-check
description: shop01 상품 동기화(GitHub Actions, sync.yml → scripts/sync.py)가 돌았는지·실패했는지 확인하고 다시 실행할 때 사용. 새 상품이 사이트에 안 뜰 때 먼저 확인.
---

# shop01 Actions 점검

동작: 매일 03:00(한국) `상품 동기화` 실행 → 시트 새 상품 → 사진 WebP 변환 → R2 업로드 → products.json 커밋
- 새 상품이 없으면 커밋 없이 정상 종료 → products.json 날짜가 오래돼도 실패가 아닐 수 있음
- gh(GitHub CLI) 미설치 → 브라우저로 확인

## 1. 실행 기록 확인
- 주소: https://github.com/dohyeonlee85/dohyeonlee85.github.io/actions
- 왼쪽 `상품 동기화` 클릭 → 최근 실행 목록
  - 초록 ✓ : 성공
  - 빨강 ✗ : 실패 → 2번
  - 노랑 ● : 실행 중 → 잠시 후 새로고침
- 마지막 동기화 커밋 확인 (PowerShell, shop01 폴더)
  ```
  git pull --no-edit; git log --oneline -3 -- products.json
  ```

## 2. 실패 로그 보기
- 실패한 실행 클릭 → `sync` 클릭 → 빨간 ✗ 단계 펼치기
- 단계별 원인 추정
  - `pip install` : scripts/requirements.txt 문제
  - `새 상품 처리` : sync.py 오류. 로그 마지막 줄 확인
    - 인증·권한(403, credentials, invalid_grant) → GitHub Secrets 값 만료·변경 의심 (Settings → Secrets → Actions). 값은 사용자가 직접 수정, 채팅·파일에 기록 금지
    - 시트 관련(KeyError, 열 이름) → 시트 머리글·입력 형식 변경 의심
    - 사진 관련(이미지 열기 실패, 404) → 시트의 사진 링크·공유 설정 확인
  - `products.json 커밋` 의 push 실패 → 같은 시간에 다른 push와 겹침, 다시 실행으로 해결
- 로그 마지막 10~20줄을 사용자에게서 받아 원인 보고 (비밀값 보이면 가리고 공유하도록 안내)

## 3. 다시 실행
- Actions → `상품 동기화` → 오른쪽 `Run workflow` → `Run workflow`
- 또는 실패한 실행 화면에서 `Re-run all jobs`
- 원인을 고치지 않고 반복 실행 금지 (1회 재실행으로 안 되면 2번 원인부터)

## 4. 성공 후
- shop01 폴더에서 `git pull --no-edit` (봇 커밋 받기, 이후 push 거절 예방)
- site-check 스킬로 상품 수·사진 확인

## 주의
- products.json 직접 수정·커밋 금지 (Actions 전용)
- sync.yml · scripts/ 수정은 사용자 요청 시에만, upload.py 위치·파일명 유지
