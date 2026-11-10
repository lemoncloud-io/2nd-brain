---
name: project-viewer-open
description: >
  프로젝트 뷰어(단일 HTML, `projects/<name>/outputs/viewer/index.html`)를 브라우저
  패널에 띄운다. 사용자가 "<프로젝트> 뷰어 보여줘", "뷰어 열어줘", "리뷰 화면 띄워줘"라고
  할 때 사용한다. 산출물이 없으면 project-viewer-build를 안내하고, 보기 요청만으로
  빌드하지 않는다.
viewer:
  id: project-viewers
  order: 20
  title: 프로젝트 뷰어
  description: 프로젝트의 설계·진행을 리뷰하는 읽기 전용 단일 HTML 뷰어.
  open:
    kind: project-viewers
origin: lemoncloud-io/knowledge@f68f1d38:projects/project-viewer/config/skills/project-viewer-open/SKILL.md
---

# project-viewer-open (뷰어 열기)

프로젝트 뷰어를 **보여 주는** 스킬이다. 만드는 쪽(`viewer.yml` 작성·`check`·`build`)은
이 스킬이 아니라 `project-viewer-build.md`가 다룬다.

## 절차

1. **산출물 확인.** `projects/<name>/outputs/viewer/index.html`이 있는지 본다. 없으면
   `project-viewer-build` 스킬을 안내한다 — 보기 요청만으로 빌드하지 않는다.

2. **신선도 보고(재빌드는 하지 않는다).**
   ```
   grep -o '"commit":"[0-9a-f]*"' projects/<name>/outputs/viewer/index.html
   ```
   이 커밋과, `projects/<name>/config/viewer.yml`의 `sources[].path`가 가리키는 원본들의
   마지막 변경 커밋(예: `git log -1 --format='%h' -- <path...>`)을 비교한다. 내장본이
   원본보다 앞선 커밋 기준이면 "내장본이 원본보다 앞선 커밋 기준이라 최신 내용과 다를 수
   있다"고 한 줄 알린다. 재빌드는 사용자가 시킬 때만 하고, 하면 산출물(추적 파일)이
   바뀌므로 브랜치 + PR로 낸다(`project-viewer-build.md` 절차를 따른다).

3. **여는 법.**
   - 브라우저 패널 도구가 있으면: 볼트 루트 정적 서버를 올리고(포트 충돌이면 새 이름으로
     등록한다 — 기존 프로세스는 죽이지 않는다) `…/projects/<name>/outputs/viewer/index.html#/<경로>`로
     연다.
   - 없으면: 단일 파일이라 `file://…/projects/<name>/outputs/viewer/index.html#/<경로>`로도
     그대로 동작한다.
   - 볼트 뷰어(`knowledge-viewer-open`)가 떠 있으면 `…/v/projects/<name>/config/viewer.yml#/<경로>`
     통합 보기로도 연다. 빌드 없이 지금 원본으로 그리고(산출물이 없어도 된다), 경로 표의 해시가
     그대로다. 원본 리더(`#/docs/<sourceId>…`)만 볼트 뷰어 리더로 넘어간다.

4. **확인.** 콘솔 오류 0건.

5. **사용자에게 알릴 것(세 줄 안으로).** 주소, 현재 페이지, 이동 방법(상단 메뉴 · 하단
   스탬프 · 근거 패널).

## 경로 표

| 경로 | 화면 |
| --- | --- |
| `#/` | 첫 페이지 |
| `#/p/<pageId>` · `#/p/<pageId>/<itemId>` | 페이지 · 그 안의 항목(노드·단계·항목·행) 선택 |
| `#/glossary` · `#/glossary/<termId>` | 용어 |
| `#/docs` · `#/docs/<sourceId>` · `#/docs/<sourceId>/<slug>` | 원본 리더 · 문서 · 절 |
| `#/search/<encoded q>` | 검색 |

## 하지 않는 것

- 외부 호스팅에 올리지 않는다.
- 원본·`viewer.yml`·셸을 고치지 않는다(내용 정정은 원본을 고치고 `project-viewer-build`로
  다시 빌드하는 경로를 쓴다).
- 보기만 하고 작업 트리에 변경을 남기지 않는다(재빌드를 사용자가 시키지 않는 한).

## 트리거 예시

- "<프로젝트> 뷰어 보여줘."
- "뷰어 열어줘, 단계 화면부터."
- "<프로젝트> 리뷰 화면 띄워줘."
