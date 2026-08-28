---
type: tool
topics:
  - knowledge-management
status: stub
sources:
  - "raw/Obsidian Web Clipper.md"
created: "2026-08-28"
updated: "2026-08-28"
---

# Obsidian Web Clipper

## Summary

Obsidian 공식 브라우저 확장으로, 웹 페이지와 그 메타데이터를 vault 안의 Markdown
파일로 저장한다. 오픈소스이며([obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper)),
클리핑 결과는 전부 로컬 vault에 저장돼 서비스 종속이 없다. 이 vault에서는
[[orchestrator-specialist-split|에이전트 파이프라인]]의 최초 유입 단계 —
`Clippings/` 인박스를 채우는 도구다.

## Use Cases

- **Articles** — 인용·각주를 포함한 본문 저장
- **References** — 책·영화·팟캐스트 메타데이터 저장
- **Academic papers** — 코드·수식 포함 저장
- **Highlight** — 페이지 위에서 텍스트·이미지·블록 단위로 하이라이트한 뒤 vault로 clip.
  하이라이트는 재방문 시에도 페이지에 남는다

## Setup Notes

- **Templates** — 페이지가 vault에 저장되는 형식을 사이트별로 정의한다.
  auto-apply 규칙으로 도메인에 맞는 템플릿을 자동 선택할 수 있다.
- **추출 대상** — meta 태그, Schema.org 변수, element selector까지 뽑을 수 있고,
  저장 전에 템플릿 문법으로 가공할 수 있다.
- **이식성** — 하이라이트와 설정은 JSON으로 export된다.
- 이 vault의 클리핑은 `Clippings/`에 쌓이고, ingest 배치가 원문을 `raw/`로 옮긴 뒤
  wiki 문서로 컴파일한다. 계약: `VAULT_RULES.md` § Workflows, `docs/raw-layout.md`.

## Related Concepts

- [[wiki/topics/knowledge-management|Knowledge Management]]

## Open Questions

- 이 vault의 ingest 규약(frontmatter 7키)에 맞춘 전용 clipper 템플릿을 정의할지 —
  현재는 clipper 기본 출력을 그대로 받고 있다.
