---
name: git-conflict
description: shop01에서 git pull·push 중 충돌(CONFLICT)이나 "would be overwritten" 오류가 났을 때 사용. git 초보용 단계별 안내. products.json은 원격 우선, 그 밖의 파일은 백업 후 원상복귀.
---

# shop01 git 충돌 대응

PowerShell, 폴더: ~\Documents\shop\github-pages\dohyeonlee85.github.io
명령은 복사 가능한 형태 + 한 줄 설명, 한 번에 2개씩 안내. 진행 중 모르는 메시지가 나오면 멈추고 전문 보고.

## 0. 현재 상태 확인
```
git status
```
- `both modified: 파일명` / `Unmerged paths` → 충돌 중 → 1번
- `error: Your local changes ... would be overwritten by merge` (pull 전에 멈춤) → 3번
- `rejected ... fetch first` (push 거절) → `git pull --no-edit` 후 다시 0번

## 1. 충돌 파일이 products.json 뿐일 때 → 원격(봇) 쪽 선택
products.json은 Actions가 만드는 파일이므로 항상 원격 쪽이 정답.
```
git checkout --theirs products.json; git add products.json
```
```
git commit --no-edit; git status
```
- `nothing to commit, working tree clean` 또는 `ahead of` 나오면 완료 → shop01-push 4번으로 push

## 2. products.json 외 파일(app.js·index.html·style.css 등)이 충돌할 때 → 백업 후 원상복귀
임의 해결 금지. 먼저 pull 이전 상태로 되돌림.
```
git merge --abort; git status
```
내 수정본 백업 (날짜-설명 폴더)
```
Copy-Item app.js,index.html,style.css -Destination (New-Item -ItemType Directory -Force ~\Documents\backup\20261030-충돌전)
```
- 날짜는 yyyyMMdd로 바꿔서 실행
- 이후: 충돌 파일명과 백업 위치를 Claude에 보고 → 원격 최신본 위에 내 수정 내용을 다시 적용하는 방식으로 처리 (backup-restore 참고)

## 3. pull 전에 "would be overwritten"으로 멈췄을 때
내 수정이 아직 커밋 안 된 상태. 백업 먼저.
```
Copy-Item app.js,index.html,style.css -Destination (New-Item -ItemType Directory -Force ~\Documents\backup\20261030-pull전)
```
- 오류에 products.json만 나오면 → 내 쪽 변경 버리고 원격 받기
  ```
  git checkout -- products.json; git pull --no-edit
  ```
- 그 밖의 파일이 나오면 → 멈추고 파일명 보고 (백업은 위에서 완료)

## 금지
- `git push --force`, `git reset --hard`, `git add -A` / `git add .`
- 충돌 표시(`<<<<<<<`, `=======`, `>>>>>>>`)가 남은 파일 커밋
- scripts/upload.py 는 사용자 요청 전엔 add 금지
