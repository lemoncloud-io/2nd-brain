---
name: ollama-local-models
description: >
  로컬 머신에서 Ollama로 LLM/VLM을 설치·서빙·호출하는 범용 절차. 모델 pull·목록·제거,
  :11434 API 호출(텍스트·vision), 다운스케일·타임아웃·실패 격리·구조화 출력 같은 운영
  수칙과 트러블슈팅을 담는다. 사용자가 로컬 모델을 띄우거나 Ollama로 추론을 돌리려 할 때
  사용한다. 개념·모델 정보의 진실원은 wiki/ollama 노트이며 이 스킬은 실행 절차만 담는다.
origin: lemoncloud-io/knowledge@6f4088ca:projects/second-brain/config/skills/ollama-local-models.md
---

# Skill: ollama-local-models (v1.0.0)

로컬 머신에서 Ollama로 LLM/VLM을 설치·서빙·호출하는 범용 워크플로우. 개념·모델 정보의 진실원은
`wiki/ollama.md`(해당 문서가 있는 볼트에서만) — 이 스킬은 실행 절차만 담는다. 도메인별 활용(사진 태깅 벤치 등)은 각 프로젝트
스킬(예: `projects/taxonomy-catalog/config/skills/local-vlm-bench.md`)을 따른다.

## 설치·기동 (macOS)

```bash
brew install ollama
ollama serve &                            # API 서버 :11434 (루프백)
curl -s http://127.0.0.1:11434/api/tags   # 생존 확인 — 이것이 유일한 외부 포트
```

주의: 실행 로그의 `llama-server listening on 127.0.0.1:<임의포트>`는 내부 포트다. 클라이언트 설정은
항상 `:11434`.

## 모델 관리

```bash
ollama pull qwen2.5vl:7b        # vision (structured output 강함 — 실전 검증됨)
ollama pull <model>:<tag>       # 태그·크기는 ollama.com/library에서 사용 시점에 확인
ollama list                     # 설치 목록·크기
ollama rm <model>               # 제거 (디스크 회수)
```

모델 선택 규칙: 메모리 한도(모델 크기 + 로드 오버헤드) 확인 → 후보를 **벤치 수치로만** 선정
(anecdotal 금지). 비영어 프롬프트 파이프라인이면 모델의 언어 지원을 먼저 확인
(예: llama3.2-vision은 이미지+텍스트에서 영어만 공식 지원).

## API 호출

```bash
# 텍스트
curl http://127.0.0.1:11434/api/generate -d '{"model":"<model>","prompt":"...","stream":false}'

# vision (이미지는 base64; 큰 원본은 장변 1024~1568px JPEG로 다운스케일 후 전송)
curl http://127.0.0.1:11434/api/chat -d '{
  "model":"qwen2.5vl:7b",
  "messages":[{"role":"user","content":"...","images":["<base64>"]}]}'
```

## 운영 수칙 (photo-catalog 실전 교훈)

1. **다운스케일 필수**: 원본(수 MB) 직송은 로컬 추론 타임아웃 유발 — vision 파생본으로 전송.
2. **타임아웃 여유**: 첫 요청은 모델 로드 시간 포함 — 120초+ 권장.
3. **실패 격리**: 호출 실패는 배치 전체 중단이 아니라 해당 단위만 강등하고 계속.
4. **구조화 출력**: 닫힌 vocabulary/스키마를 프롬프트에 명시하고, 응답은 salvage 필터로 계약 위반
   값만 제거 (all-or-nothing 파싱 금지).
5. **메모리**: 24GB급에서 대형 vision 모델(11B+) 교대 로드는 실패 요인 후보 — 벤치는 모델당 순차로.

## 트러블슈팅

| 증상 | 조치 |
| --- | --- |
| connection refused :11434 | `ollama serve` 기동 여부 확인 |
| 첫 호출만 매우 느림 | 모델 cold load — 정상. 배치 전 워밍업 호출 1회 |
| 호출 즉시 실패(전건) | `ollama list`로 모델 존재 확인 → Ollama 서버 로그 대조(모델 로드 실패/메모리) |
| 응답이 스키마 위반 | 프롬프트에 닫힌 값 목록·JSON 예시 강화 + salvage 필터 |
