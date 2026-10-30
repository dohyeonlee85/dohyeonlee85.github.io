---
name: shop01-push
description: shop01(dohyeonlee85.github.io) 수정 파일을 GitHub에 올려 사이트에 반영할 때 사용. pull → 변경 파일만 add → commit → push → 확인.
---

# shop01 push 절차

PowerShell 기준. 명령은 복사 가능한 형태 + 한 줄 설명, 한 번에 2개씩 안내.

1. 위치 이동 + 최신 받기 (Actions 봇이 products.json을 커밋하므로 필수)
   ```
   cd ~\Documents\shop\github-pages\dohyeonlee85.github.io; git pull --no-edit
   ```
2. 변경 파일 확인
   ```
   git status
   ```
3. 이번 작업 파일만 지정해서 add
   ```
   git add app.js index.html style.css
   ```
   - `git add -A` / `git add .` 금지
   - scripts/upload.py 는 로컬 미완 수정 상태 → 사용자가 따로 요청하기 전엔 add 금지
   - products.json 은 Actions가 관리 → 직접 add 금지
4. 커밋 + 올리기
   ```
   git commit -m "변경 내용 한 줄"; git push
   ```
5. 확인: 1~2분 후 사이트에서 Ctrl+F5 (강력 새로고침)
   - `git show --stat HEAD` 로 올라간 파일이 의도한 것뿐인지 확인

## 오류 대처
- push 거절(rejected) → 1번 git pull 후 4번 다시
- pull 중 충돌(CONFLICT)·would be overwritten → git-conflict 스킬 절차
