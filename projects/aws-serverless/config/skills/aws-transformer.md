---
name: aws-transformer
description: >
  서버리스 파이프라인의 가공 코드(`mts`) 하나를 만드는 절차 — 원본 파일(JSON·CSV·로그)을
  레코드마다 JSON으로 바꾸는 `transformers/<형식>.mts` 를 쓰고, 로컬에서 돌리고, 테스트하고, 필요하면 색인 매핑
  `mappings/<형식>.ts` 를 붙인다. 사용자가 "mts 만들어줘", "가공 코드", "이 파일 형식 파서", "transformer 추가",
  "원본을 레코드별 JSON으로"처럼 요청할 때 사용한다. 키·저장·보존·색인은 공통 코드가 하므로 여기서 만들지 않는다.
  스택 배포는 `aws-s3-ingest`·`aws-opensearch`.
---

# AWS Transformer (`mts` 하나 = 데이터 형식 하나)

담당자가 만드는 것은 **파일 하나**다: `config/sam/stack1-ingest/src/transformers/<이름>.mts`.
S3에 `raw/<이름>/<날짜>/<파일>` 로 올라온 파일이 이 코드를 지나 레코드마다 DynamoDB 행이 되고, 스택 ②가
`<IndexName>-<이름>` 인덱스에 색인한다. 목록·스위치·템플릿 파라미터를 고치지 않는다 — esbuild가 폴더 안
`*.mts` 를 모두 번들에 넣고(2026-10-12 `sam build` 산출물 확인), Lambda가 경로의 이름으로 찾는다.

## 계약

```ts
import type { Transformed } from "../transform.js";
export const transform = (body: string): Transformed[] | undefined => …
// Transformed = { data: {…}, pointer: "/records/3", bytes: <원본 레코드 UTF-8 바이트>, time?: "<ISO>" }
```

| 필드 | 뜻 |
|---|---|
| `data` | 색인·집계에 쓸 필드만. 자유문·큰 본문은 넣지 않는다(원본은 S3에 그대로 있고 `raw$ref` 가 가리킨다) |
| `pointer` | 원본 안 위치(JSON Pointer, `/records/3`). CSV·줄 단위면 줄 번호를 `/<줄>` 로 |
| `bytes` | 원본 레코드 크기 |
| `time` | 레코드 자체 시각 — 보존(`TtlDays`)이 여기서 센다. 없으면 적재 시각 |
| `undefined` 반환 | "이 형식이 아님" → 파일은 기존 generic 행 하나로 저장된다 |

공통 코드가 붙이는 것(`src/transform.ts` `transformedRows`) — **mts에서 만들지 않는다**: 행 키 `<sha256(S3 키) 앞 16자>.<NNN>.json`,
정렬 키 = S3 버전, `raw$ref`, `ttl`, `transformer: <이름>`. 파일 행은 마지막에 `count` 만.
스택 ① `SidecarEnabled=true` 면 같은 레코드가 `sidecar/<이름>/<날짜>/<파일>.jsonl` 에도 한 줄씩 나간다(Athena용, `aws-s3-ingest` 0번) — 이것도 mts에서 하지 않는다.

## 이름 규칙

- **데이터 형식 이름**, 회사·고객 이름 아님: `llm-gateway-log`, `air-measurement-list`, `attendance`. 소문자·숫자·`-` 만(`^[a-z0-9]+(-[a-z0-9]+)*$`).
- 같은 형식이면 다른 프로젝트도 같은 파일을 쓴다. 어느 프로젝트가 어떤 형식을 쓰는지는 **그 프로젝트 README**에 적는다.
- 파일 이름 = S3 경로 첫 칸(`raw/` 다음) = 스택 ② 매핑 파일 이름 = 인덱스 접미사.

## 만드는 순서

1. 시작점 복사: `cp src/transformers/example-list.mts src/transformers/<이름>.mts` (합성 형식 예시 — 계약·파싱 실패 처리가 들어 있다).
2. 형식에 맞게 고친다. 필드는 As-Is/To-Be 양식에서 정한 것만. 다른 파일의 헬퍼를 import 하지 말고 파일 안에 둔다(파일 하나로 옮겨 쓸 수 있게).
3. 로컬 실행 — 한 줄에 JSON 하나, 마지막 줄에 레코드 수:
   ```bash
   cd config/sam/stack1-ingest && npx tsx scripts/run-transform.mts <이름> <파일>
   ```
   없는 이름이면 폴더 안 이름 목록을, 형식이 아니면 `not a file this transformer reads`(종료 코드 65)를 낸다.
4. 테스트 `test/<이름>.test.ts` — **합성 픽스처만**(고객 원본·실제 값 금지, 구조만 따라 한다). 최소 세 가지:
   ```ts
   import { transform } from "../src/transformers/<이름>.mjs";
   it("레코드마다 하나, 순서·pointer·time", () => { const items = transform(body)!; expect(items).toHaveLength(2); expect(items[1]).toMatchObject({ pointer: "/items/1" }); });
   it("명세 밖 필드·자유문은 없다", () => expect(transform(body)![0].data).not.toHaveProperty("note"));
   it("다른 형식·깨진 파일 → undefined", () => expect(transform("not json")).toBeUndefined());
   ```
   `npm test` 전체 통과 + `npx tsc --noEmit`. 예시: `test/llm-gateway-log.test.ts`, 경로 분기는 `test/routing.test.ts`.
5. (색인 필드를 고정하려면) 스택 ② 매핑 `config/sam/stack2-index/src/mappings/<이름>.ts`:
   `export const ID_FIELD = "<중복 제거 기준 필드>"`(없으면 행 키) + `export const INDEX_BODY = { mappings: { dynamic: "strict", properties: {…} } }`.
   시작점은 `mappings/example-list.ts`. 매핑에 적은 필드만 색인되고(`ingestedAt`·`indexedAt` 은 행에서 붙는다) 나머지는 DynamoDB에만 남는다.
   **매핑 파일이 없으면** 그 행은 generic 인덱스(`<IndexName>`)에 행 전체로 들어간다 — 형식마다 strict 매핑이 달라 한 인덱스에 섞을 수 없어서 형식별 인덱스로 나눈다.
6. `sam build` 후 번들에 들어갔는지: `grep -o '"./transformers/[a-z-]*.mts"' .aws-sam/build/IngestFunction/ingest.js | sort -u`.
7. 배포는 `aws-s3-ingest`(스택 ①) → 매핑을 더했으면 `aws-opensearch`(스택 ②). 인덱스는 첫 문서가 올 때 만들어진다. 업로드 경로: `raw/<이름>/<YYYY-MM-DD>/<파일>`.

## 한도 (공통 코드 기준)

| 항목 | 값 | 근거 |
|---|---|---|
| 파일 크기 | 32 MiB 이하(Content-Type 무관). **넘으면 실패** → 재시도 2회 → DLQ → 알람 메일(`AlarmEmail`) — 파일을 나눠 다시 올린다 | `MAX_TRANSFORM_BYTES`(1,024 MB 함수, 32.5 MB 파일 최대 메모리 269 MB) |
| 레코드 수 | 파일당 50,000. **넘으면 실패**(위와 같은 경로). 한 번 실행(300초) 안에 끝나야 한다 — 재시도는 모든 Put 을 다시 보낸다 | `MAX_TRANSFORMED_ROWS`(1,024 MB에서 초당 655~980행, 5만 건 51초 — `aws-serverless/logs/ingest-large-transformer-files-2026-10-13.md`) |
| 본문 | UTF-8 문자열 한 덩어리. gzip·엑셀(바이너리)은 아직 못 받는다 | `ingest.ts` `enrich` |
| 행 크기 | `data` 를 작게 — 1 KB 안이면 쓰기 1단위 | `llm-gateway-log` 행 634~641 B(10-12 실측) |

## 실패 모드

- 경로가 `raw/<이름>/` 이 아니거나 이름 파일이 없다 → generic 행(파일 하나 = 행 하나). 행에 `transformer` 가 없으면 이 경우다.
- `transform` 이 던진다(파싱 버그) → 재시도 2회 → DLQ. 형식이 아니면 던지지 말고 `undefined`.
- 파일이 한도(위 표)를 넘는다 → 같은 경로로 DLQ·알람, 오류 메시지 `… over MAX_TRANSFORM_BYTES …`/`… over MAX_TRANSFORMED_ROWS …` `— split the file`. 레코드는 하나도 쓰이지 않는다 — 나눠서 다시 올린다.
- 매핑에 없는 필드는 색인 안 될 뿐 오류 아님. 매핑 타입과 다른 값(숫자 필드에 문자열) → `mapper_parsing_exception` → 스택 ② DLQ.
- 매핑을 바꿨다 → 새 인덱스 + `scripts/reindex.ts`(`aws-opensearch` § 매핑 변경).
