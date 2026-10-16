---
name: aws-athena
description: >
  서버리스 파이프라인의 옵션 질의 경로 — 스택 ① 이 S3 `sidecar/` 에 쓰는 NDJSON 을 Athena(SQL)로
  조회하게 SAM 스택 ③ `stack3-query`(결과 버킷·워크그룹·Glue DB)를 켜고, 표를 DDL 로 정의하고, 질의 결과를
  JSON 으로 받아 대시보드에 붙이고, 끄는 절차. 사용자가 "Athena 로 조회", "OpenSearch 없이 싸게 검색",
  "월 10만 원 안쪽으로 질의", "sidecar 를 SQL 로", "표 정의(DDL) 만들어줘", "질의 결과를 대시보드에 붙여"처럼
  요청할 때, 또는 이 파이프라인의 Athena·Glue·워크그룹·스캔 상한·옵션 정책(`SlsAthenaAllow`·
  `SlsStaffAthena`)이 화제에 오르면 사용한다. 실시간·벡터·전문 검색은 `aws-opensearch`. 기본은 꺼짐이다.
---

# AWS Athena (옵션 — sidecar NDJSON 을 SQL 로)

Athena 는 S3 에 있는 파일을 그 자리에서 SQL 로 읽는다. 서버도 고정비도 없고, **질의가 읽은 바이트만큼**
과금된다(서울 TB당 USD 5.00, 질의당 최소 10MB). 이 파이프라인에서는 스택 ① 이 원본 옆 `sidecar/` 에 쓴
가공 레코드(NDJSON)가 대상이다. 원본·DynamoDB·OpenSearch 경로는 그대로이고, 이 스킬의 스택을 지워도
아무것도 깨지지 않는다.

## 왜 이렇게 하나 (고객 설명용 한 문단)

질의가 가끔이고 양이 적고 실시간이 아니면, 검색 엔진을 켜 두는 비용(OpenSearch Serverless 최소 월 약
USD 214, `aws-opensearch § 비용`)이 아깝다. Athena 는 켜 두는 것이 없어 쓰지 않는 달은 0원에 가깝고,
하루치 폴더만 읽게 짜면 한 번에 몇 원이다. "월 10만 원 미만" 을 원하면 Athena, 양·질·실시간이
중요하면 OpenSearch 를 고른다.

## 전제 조건

- **질의 방식으로 Athena(또는 둘 다)를 골랐다** — 아래 켜는 법 0번. sidecar 는 기본 꺼짐이라 묻지 않고 켜지 않는다.
- 스택 ① 배포 완료, 그리고 스택 ① 을 `SidecarEnabled="true"`(기본 `"false"`, `aws-s3-ingest` 절차 0번)로 배포해 `sidecar/` 가 쌓이고 있다(계약은 아래 "sidecar 계약").
- AWS CLI v2, SAM CLI 1.150+ — 로컬 PC.
- 배포 키에 **옵션 정책 `SlsAthenaAllow`** 가 더 붙어 있다(아래 1번, 계정 관리자 조치). 없으면
  스택 ③ 이 `athena:CreateWorkGroup` 에서 `AccessDenied` 로 롤백된다.
- `SlsGuardDeny` 가 옵션 Athena 판이다(NotAction 에 `athena:StartQueryExecution` 이 있는 판, 2026-10-12).
  옛 판(v5)이면 옵션 정책을 붙여도 `explicit deny` 다.
- 리전은 `ap-northeast-2`(서울) 고정. 모든 `aws` 명령에 `--profile <slug>` 를 붙인다 — 기본 프로파일은 우리 계정이다.
  ```bash
  export AWS_REGION=ap-northeast-2
  ```

## sidecar 계약 (스택 ① 이 쓰는 쪽, 여기는 읽기만)

| 항목 | 값 |
|---|---|
| 원본 | `raw/<source>/<YYYY-MM-DD>/<file>.json` |
| sidecar | `sidecar/<source>/<YYYY-MM-DD>/<file>.jsonl` (`<file>` = 원본 파일 이름 전체, 예 `a.json.jsonl`) — **한 줄 = 가공 레코드 1개**(NDJSON) |
| 파티션 | 날짜 폴더. partition projection 으로 읽는다 — 크롤러·`MSCK REPAIR` 없음 |
| `<source>` | 스택 ① 의 변환기 형식(`raw/<형식>/…` 의 `<형식>`) — 표 하나 = 형식 하나 |
| 만드는 규칙 | 스택 ① 이 변환기로 읽은 파일마다 `sidecar/<형식>/<raw 경로 나머지>.jsonl` 에 한 번 쓴다(원본 이름 전체 뒤에 `.jsonl` — 같은 폴더의 `a.csv`·`a.json` 이 서로 덮지 않는다, 2026-10-16). 같은 경로에 다시 올리면 **최신 버전의 이벤트만** 쓴다 — 늦게 오거나 다시 온 옛 버전 이벤트는 sidecar 를 건너뛴다(행은 만든다). 형식이 없는 일반 파일은 sidecar 가 없다 |
| **업로드 규칙** | 원본을 `raw/<형식>/<YYYY-MM-DD>/<파일>` 로 올려야 sidecar 가 날짜 폴더에 생겨 파티션에 잡힌다 — 날짜 칸은 raw 경로를 그대로 쓴다. 하위 폴더가 있으면 sidecar 도 같은 깊이로 생기고(스택 ① `sidecarKey`), 날짜 파티션은 그 하위 폴더 파일까지 읽는다(실측 `logs/athena-option-e2e-v2.md` Q3). `aws-transformer` 스킬의 업로드 경로도 `raw/<이름>/<YYYY-MM-DD>/<파일>` 이다 |
| `dt` 와 레코드 날짜 | `dt` 는 업로드 폴더 날짜다. 레코드 시각의 날짜(`dayKst`)와 다를 수 있다(e2e-v2 Q4). 스캔을 줄이는 조건은 `dt`, 레코드 날짜로 묶는 집계는 `daykst` — 둘을 같이 쓴다: `WHERE dt BETWEEN …(하루 넓게) AND daykst = …` |
| 다시 올리면 | 같은 sidecar 키를 덮어쓴다(Athena 는 최신만 읽는다). 그때 sidecar 의 `ingestedAt` 은 DynamoDB 행의 첫 적재 시각과 다를 수 있다 |

Athena 의 JSON SerDe 는 한 줄에 레코드 하나만 읽는다(AWS `hive-json-serde.html`). 들여쓴 JSON·배열 하나짜리
파일은 `HIVE_CURSOR_ERROR: Row is not a valid JSON Object` 로 실패한다 — 그건 스택 ① 쪽 문제다.

## 만들어지는 것 (`../sam/stack3-query/template.yaml`)

```
s3://<데이터 버킷>/sidecar/<source>/<날짜>/*.jsonl      (스택 ① 소유 — 읽기만)
        │  SELECT … WHERE dt = '…'   (워크그룹 설정이 클라이언트 설정을 덮어씀)
        ▼
 Athena 워크그룹 <스택명>  ── 질의당 스캔 상한(기본 1 GiB, 넘으면 취소) · CloudWatch 지표
        │ 결과 CSV
        ▼
 결과 버킷 <스택명>-results-<계정ID>  (퍼블릭 차단 · SSE-S3 · TLS 전용 · N일 뒤 삭제 · 미완료 업로드 1일 뒤 정리)
 Glue DB sls_<회사>  ── 표는 DDL 로(무료) — 아래 "표 정의"
```

| 이름 (스택명 = `<S>` = `sls-<slug>-query`) | 값 |
|---|---|
| 워크그룹 | `<S>` |
| 결과 버킷 | `<S>-results-<계정ID>` — 결과는 `results/` 아래 |
| Glue DB | 파라미터 `DatabaseName` (`sls_<회사>`, 소문자·밑줄만 — Athena 이름 규칙, 정책 `database/sls_*`) |
| 파라미터 | `DataBucketName`(스택 ① `BucketName`, 필수) · `DatabaseName`(필수) · `BytesScannedCutoffPerQuery`(기본 1073741824 = 1 GiB, 최소 10,000,000, 최대 2,147,483,647 — CloudFormation 이 이 값을 Integer 로 받는다) · `ResultsExpirationDays`(기본 7) |
| Outputs | `WorkGroupName` · `ResultsBucketName` · `DatabaseName` · `SidecarLocation` |

## 켜는 법

0. **먼저 묻는다 (스택 ① 배포 전 요구 정리).** 질의 방식 넷 — 검색 엔진만 / Athena 만 / 둘 다 / 둘 다 안 씀 — 중 하나를 고르게 하고,
   Athena 는 질의할 때만 과금되지만 **sidecar 를 켜는 순간부터 질의와 무관하게 저장·업로드 비용이 쌓인다**는 것을 같이 알린다
   (월 1만 파일·누적 1GB 면 월 USD 0.1 안쪽, 월 100만 파일이면 업로드만 USD 4.5).
   답과 근거는 프로젝트 README 에 남긴다. Athena·둘 다가 아니면 여기서 멈춘다 — 이 스킬의 나머지와 sidecar 는 켜지 않는다.
   나중에 켜면 그날부터의 데이터만 sidecar 가 생긴다(이전 데이터는 소급 스크립트가 필요 — 스택 ① 레인).
1. **정책 (계정 관리자, 콘솔 5분).** IAM → 정책 → 정책 생성 → JSON 탭에 `../policies/SlsAthenaAllow.json`
   을 붙여넣고 이름 `SlsAthenaAllow` 로 생성 → 사용자 그룹 `sls-operators` → 권한 추가 → 그 정책 연결.
   `SlsGuardDeny` 가 옛 판이면 같은 화면에서 정책 → `SlsGuardDeny` → 편집 → JSON 을 새 판으로 바꿔 저장(새 버전이 기본이 된다).
   배포 키는 정책을 만들거나 붙일 수 없다(GuardDeny `iam:CreatePolicy`·`iam:AttachGroupPolicy` 거부).
   **정책을 붙인 뒤 3분 기다리고** 다음 단계 — IAM 전파 지연.
2. **검증.** `../scripts/verify.sh <slug> <12자리 계정ID>` — `V2` 가 "관리형 3개(옵션 SlsAthenaAllow 포함)" 로 PASS 하고
   `V3e`~`V3e5`·`V4k`·`V4l`·`V4l2`·`V8c` 가 PASS 여야 한다(새 계정 기준 48 PASS — 시험 발판 기준, 실키 미실측). 반려(exit 1)면 멈춘다.
3. **설정.** `../sam/stack3-query/samconfig.<slug>.toml` 을 `samconfig.toml` 에서 복사해 `stack_name = "sls-<slug>-query"`,
   `DataBucketName`(스택 ① Outputs `BucketName`), `DatabaseName`(`sls_<slug>`, 하이픈은 밑줄로)을 채운다.
   **스캔 상한은 데이터에 맞춰 정한다**(기본 1 GiB 는 자리값) — 아래 "스캔 상한 정하기" 로 계산해 `parameter_overrides` 끝에
   ` BytesScannedCutoffPerQuery=\"<바이트>\"` 를 더한다.
4. **배포** (코드가 없어 `sam build` 없음, `resolve_s3 = false` — 제한 role 로 1차 성공):
   ```bash
   cd ../sam/stack3-query
   sam deploy --config-file samconfig.<slug>.toml --profile <slug>
   ```
5. **표 정의** — 아래 "표 정의" 의 DDL 을 `run_query` 로 한 번(DDL 은 무료).
6. **스모크.** `SELECT dt, count(*) FROM <표> WHERE dt = '<sidecar 가 있는 날짜>' GROUP BY dt` 가 0 이 아닌 건수를 돌려주면 통과.
   0 이면 "자주 막히는 곳".
7. **(선택) 실무자 질의.** 계정 관리자가 `../policies/SlsStaffAthena.json` 으로 정책 `SlsStaffAthena`
   를 만들어 `sls-staff-query` 그룹에 더 붙인다. 실무자는 `sls-*` 워크그룹에서 질의만 하고, 표·워크그룹(스캔 상한)은
   못 바꾸고, 데이터 버킷은 `sidecar/` 만 읽는다(판정 `../scripts/staff-policy-sim.sh` A1~A17).

질의 실행 함수 — 이 스킬의 명령은 전부 이것으로 돈다(`--profile` 은 함수 안에서 고정):

```bash
P=<slug>; WG=sls-<slug>-query; DB=sls_<slug>
run_query() {   # $1 = SQL. 끝나면 상태·스캔 바이트를 찍고 결과를 /tmp/athena-<id>.json 에 둔다
  local id st
  id=$(aws athena start-query-execution --profile $P --work-group $WG \
        --query-execution-context Database=$DB --query-string "$1" --query QueryExecutionId --output text) || return 1
  while st=$(aws athena get-query-execution --profile $P --query-execution-id $id --query QueryExecution.Status.State --output text);
        [[ $st == QUEUED || $st == RUNNING ]]; do sleep 2; done
  aws athena get-query-execution --profile $P --query-execution-id $id \
    --query 'QueryExecution.[Status.State,Status.StateChangeReason,Statistics.DataScannedInBytes]' --output text
  [[ $st == SUCCEEDED ]] && aws athena get-query-results --profile $P --query-execution-id $id --output json > /tmp/athena-$id.json \
    && echo "/tmp/athena-$id.json"
}
```

## 스캔 상한 정하기 (데이터별)

상한은 "정상 질의는 통과, 실수로 전체를 읽는 질의는 취소" 되는 값이다. 데이터마다 하루 양과 한 번에 보는 기간이 달라 데이터별로 정한다.

1. 하루치 sidecar 크기를 잰다(데이터가 쌓인 뒤, 많은 날 기준):
   ```bash
   aws s3 ls s3://<데이터 버킷>/sidecar/<source>/<YYYY-MM-DD>/ --recursive --summarize --profile <slug> | tail -1   # Total Size: <바이트>
   ```
2. 상한 = 하루 크기 × 한 질의에서 보는 기간(일, 요구 정리에서 확인 — 보통 7·30) × 1.5. 최소 10,000,000.
3. CloudFormation 최대는 2,147,483,647(약 2 GiB — 템플릿 Integer 제약). 계산값이 이보다 크면 기간 질의를 월 단위로 나누는 쪽을 먼저 권한다.
   그래도 필요하면 배포 뒤 `aws athena update-work-group --profile <slug> --work-group <S> --configuration-updates BytesScannedCutoffPerQuery=<바이트>`
   (API 는 Long 이라 더 큰 값을 받는다 — 문서 기준, 미실측). 단 스택을 다시 배포하면 템플릿 값으로 돌아가므로 프로젝트 README 에 적어 두고 재배포 뒤 다시 건다.
4. 정한 값과 근거(하루 크기·기간)를 프로젝트 README 에 남긴다. 데이터가 크게 늘면 1번부터 다시.

데이터가 아직 없을 때(첫 배포)는 기본 1 GiB 로 두고, 2주쯤 쌓인 뒤 위 순서로 맞춘다.

## 표 정의 (DDL 템플릿 + 작성 규칙)

표는 데이터마다 다르다 — 레코드 필드가 다르기 때문이다. 아래는 **예시 프로필**(LLM 게이트웨이 로그, 레코드 25필드)이고,
다른 데이터는 작성 규칙대로 컬럼만 바꾼다. `<데이터 버킷>`·`<source>` 를 채운다.

```sql
CREATE EXTERNAL TABLE IF NOT EXISTS llm_gateway_log (
  responseid        string,
  createdat         string,   -- ISO 8601 UTC. 질의에서 from_iso8601_timestamp(createdat)
  daykst            string,
  gateway           string,
  provider          string,
  model             string,
  statuscode        int,
  success           boolean,
  responsestatus    string,
  errorcode         string,
  incompletereason  string,
  durationms        bigint,
  cached            boolean,
  tokensin          bigint,
  cachedtokens      bigint,
  cachewritetokens  bigint,
  tokensout         bigint,
  reasoningtokens   bigint,
  totaltokens       bigint,
  websearchrequests int,
  imagegentokens    bigint,
  reasoningeffort   string,
  maxoutputtokens   bigint,
  ingestedat        string,
  rawkey            string,   -- 원본 S3 키 (스택 ① 이 raw$ref 와 같이 쓰는 $ 없는 키)
  rawversionid      string,
  rawpointer        string
)
PARTITIONED BY (dt string)
ROW FORMAT SERDE 'org.apache.hive.hcatalog.data.JsonSerDe'
LOCATION 's3://<데이터 버킷>/sidecar/<source>/'
TBLPROPERTIES (
  'projection.enabled'          = 'true',
  'projection.dt.type'          = 'date',
  'projection.dt.format'        = 'yyyy-MM-dd',
  'projection.dt.range'         = '2026-01-01,NOW+1DAYS',
  'projection.dt.interval'      = '1',
  'projection.dt.interval.unit' = 'DAYS',
  'storage.location.template'   = 's3://<데이터 버킷>/sidecar/<source>/${dt}/'
)
```

작성 규칙:

1. **표 하나 = `<source>` 하나.** 레코드 모양이 다른 source 를 한 표에 섞지 않는다. 표 이름은 소문자·밑줄(`llm_gateway_log`).
2. **컬럼 이름은 JSON 키를 소문자로.** Athena 는 이름을 소문자로 바꾼다(`tables-databases-columns-names.html`). Hive JSON SerDe 는
   camelCase 키(`responseId`)를 소문자 컬럼(`responseid`)에 맞춘다(2026-10-12 실측, `logs/athena-option-v1.md` Q3).
   OpenX SerDe(`org.openx.data.jsonserde.JsonSerDe`)는 쓰지 않는다 — AWS 문서가 "결과가 비결정적일 수 있다" 고 경고한다.
3. **타입이 확실하지 않으면 `string`** 으로 두고 질의에서 `TRY_CAST(x AS bigint)`. Hive SerDe 는 선언 타입과 다른 값이 오면 질의가
   실패한다(`미검증`). 시각도 `string` + `from_iso8601_timestamp()` — SerDe 의 timestamp 파싱 형식 문제를 피한다.
4. **`raw$ref` 같은 `$` 든 키는 컬럼으로 못 만든다** — Hive JSON SerDe 문서에 키→컬럼 매핑이 없다. 선언하지 않으면 오류 없이 무시된다(실측 Q3).
   그래서 스택 ① 이 같은 정보를 `$` 없는 키 `rawKey`·`rawVersionId`·`rawPointer` 로도 쓴다 — 위 DDL 의 마지막 세 컬럼. 스택 ① 이 쓴 sidecar 로 실측했다(e2e-v2 Q2 — 전 줄 채워짐).
   `"$path"`(행이 나온 sidecar 파일 경로)로도 찾을 수 있다.
5. **중첩 객체는 `struct<…>`, 배열은 `array<…>`** 로 선언하고 `UNNEST` 로 편다(`openx-json-serde.html` 예시).
6. **파티션은 `dt` 하나, 타입 `string`, partition projection.** `projection.dt.range` 의 시작은 첫 데이터 날짜 이전으로, 끝은
   `NOW+1DAYS` — projection 의 날짜는 질의 시점 UTC 로 만들어져(`partition-projection-supported-types.html`) KST 오늘 폴더를 놓치지 않게 하루 더 둔다.
   projection 을 켜면 카탈로그에 등록된 파티션은 무시된다 — `MSCK REPAIR`·크롤러를 쓰지 않는다.
7. 표를 고치려면 `DROP TABLE <표>` 후 다시 `CREATE` — 데이터(S3)는 지워지지 않는다(EXTERNAL). DDL 은 과금되지 않는다.

```bash
run_query "$(cat llm_gateway_log.sql)"      # 위 DDL 을 파일로 두고. 결과는 상태 줄만
run_query "SHOW TABLES"
```

## 질의 예시 (AI 인사이트용 — Claude 가 이 틀로 SQL 을 만든다)

원칙: **항상 `WHERE dt …` 로 날짜를 좁힌다** — 안 좁히면 sidecar 전체를 읽어 스캔 상한(기본 1 GiB)에 걸려 취소되고, 취소 전까지 읽은 양은 과금된다(`workgroups-setting-control-limits-cloudwatch.html`).

| 질문 | SQL |
|---|---|
| 일별·모델별 호출·토큰 | `SELECT dt, model, count(*) AS calls, sum(totaltokens) AS tokens FROM llm_gateway_log WHERE dt BETWEEN '2026-10-01' AND '2026-10-12' GROUP BY 1, 2 ORDER BY 1, 2` |
| 공급자별 실패율 | `SELECT provider, count_if(NOT success) * 1.0 / count(*) AS fail_rate, count(*) AS n FROM llm_gateway_log WHERE dt >= '2026-10-01' GROUP BY 1 ORDER BY 2 DESC` |
| 느린 응답 상위 | `SELECT responseid, model, durationms FROM llm_gateway_log WHERE dt = '2026-10-12' ORDER BY durationms DESC LIMIT 20` |
| 캐시 적중 비율 | `SELECT model, sum(cachedtokens) * 1.0 / nullif(sum(tokensin), 0) AS cache_ratio FROM llm_gateway_log WHERE dt >= '2026-10-01' GROUP BY 1` |
| 시간대별(UTC→KST) | `SELECT hour(from_iso8601_timestamp(createdat) AT TIME ZONE 'Asia/Seoul') AS h, count(*) FROM llm_gateway_log WHERE dt = '2026-10-12' GROUP BY 1 ORDER BY 1` |
| 레코드의 원본 찾기 | `SELECT "$path", responseid FROM llm_gateway_log WHERE dt = '2026-10-12' AND responseid = '<id>'` |

### OpenSearch 와 숫자 맞추기 ("둘 다" 고른 경우)

스택 ② 는 변환기 레코드를 형식별 인덱스 `docs-<형식>` 에 **형식의 ID 필드(LLM 로그는 `responseId`)당 문서 1개**로 넣는다 — 같은 레코드가 다시 오면 덮어쓴다.
Athena 는 sidecar **줄마다 1행**이라, 같은 레코드가 다시 올라오거나(재업로드·다른 파일) 겹치면 두 번 센다(실측 R3·R4).
두 엔진의 건수를 맞추려면 Athena 쪽을 고유 기준으로 센다:

```sql
SELECT count(DISTINCT responseid) FROM llm_gateway_log WHERE dt BETWEEN '2026-10-01' AND '2026-10-12'
-- 위 줄은 실측(both-v3 R4). 레코드 단위 집계가 필요하면 최신 1줄만 남긴다 — 아래는 실행해 보지 않았다(미실측)
SELECT model, count(*), sum(totaltokens) FROM (
  SELECT *, row_number() OVER (PARTITION BY responseid ORDER BY ingestedat DESC) AS rn
  FROM llm_gateway_log WHERE dt BETWEEN '2026-10-01' AND '2026-10-12'
) WHERE rn = 1 GROUP BY 1
```

겹침이 없으면 두 엔진의 건수·합계·그룹별 수가 정확히 같다(실측 R5). 겹친 레코드의 내용이 서로 다르면 어느 쪽이 남느냐가 엔진마다 다를 수 있다(OpenSearch 는 마지막으로 색인된 것 — 위 `row_number` 와 같은지는 `미검증`).

## 대시보드 — 질의 결과를 JSON 으로 붙이기

`run_query` 가 남긴 `get-query-results` 출력은 행 배열(첫 행이 머리글)이다. 객체 배열로 바꿔 HTML 에 붙인다:

```bash
python3 -c 'import sys,json;r=json.load(open(sys.argv[1]))["ResultSet"]["Rows"];h=[c.get("VarCharValue") for c in r[0]["Data"]];print(json.dumps([dict(zip(h,[c.get("VarCharValue") for c in x["Data"]])) for x in r[1:]],ensure_ascii=False))' /tmp/athena-<id>.json > result.json
```

값은 전부 문자열로 온다 — 숫자는 HTML 쪽에서 `Number()`. `get-query-results` 한 번은 최대 1,000행이다(`--max-items` 로 나눔 — `미검증`).
집계해서 수십 행으로 줄여 붙이는 것이 원칙이다.

## 비용

- 스캔 TB당 USD 5.00(서울), 성공·취소 질의 최소 10MB·MB 단위 올림. DDL·실패 질의는 무료. 결과 파일은 S3 요금
  (근거는 AWS Athena·Glue 요금 문서).
- 예: 최소 단위 10MB 질의 1,000번 = 10GB = USD 0.05. 1 GiB 상한까지 읽는 질의 1,000번 = 약 1TB = 약 USD 5. Glue 카탈로그는 객체·요청
  각 100만까지 무료, partition projection 이라 크롤러 비용 없음.
- 고정비 0 — 스택 ③ 을 켜 둬도 질의하지 않으면 결과 버킷 보관료(수명 주기로 N일 뒤 삭제)뿐이다.
- 못 막는 것: 질의 횟수. 상한은 질의 하나에 걸린다 — 워크그룹 전체 알림은 CloudWatch 경보로 따로(이 스택에 없음, `미검증`).
  배포 키는 `UpdateWorkGroup` 으로 상한을 바꿀 수 있다 — 재검증 때 `aws athena get-work-group --profile <slug> --work-group <S> --query WorkGroup.Configuration.BytesScannedCutoffPerQuery`.
- 옵션을 켜도 용량 예약(서울 최소 4 DPU 상시 월 USD 963.60)·Spark·Glue ETL 은 GuardDeny 가 막는다(verify V4k).

## 자주 막히는 곳

| 증상 | 원인 | 대응 |
|---|---|---|
| 배포 롤백 `athena:CreateWorkGroup … explicit deny` | `SlsGuardDeny` 가 옛 판(v5) | 켜는 법 1번의 GuardDeny 새 판 |
| 배포 롤백 `… not authorized … athena:CreateWorkGroup`(explicit 없음) | `SlsAthenaAllow` 미부착, 또는 스택명이 `sls-` 로 시작하지 않음 | 정책 부착·3분 대기 / 스택명 `sls-<slug>-query` |
| `Glue … AccessDeniedException` | `DatabaseName` 이 `sls_` 로 시작하지 않음 | 파라미터 고쳐 재배포 |
| 질의 상태 `CANCELLED`, 사유 `Bytes scanned limit was exceeded`(실측 — 상한만큼 스캔한 뒤 취소, 그만큼 과금) | 스캔 상한 | `WHERE dt` 로 좁힌다. 정말 필요하면 상한 파라미터를 올려 재배포 |
| 결과 0 행 | `LOCATION`·`storage.location.template` 의 버킷·source 오타, `dt` 가 range 밖, 그날 sidecar 없음 | `aws s3 ls s3://<데이터 버킷>/sidecar/<source>/ --profile <slug>` 로 폴더 확인 |
| 컬럼 하나가 전부 NULL | JSON 키와 컬럼 이름의 철자가 다름(대소문자는 상관없다 — 규칙 2) | 레코드 한 줄을 열어 키 철자 확인 후 `DROP`·`CREATE` |
| `HIVE_CURSOR_ERROR: Row is not a valid JSON Object` | sidecar 가 NDJSON 이 아님 | 스택 ① 쪽 수정 |
| 올린 파일이 질의에 안 나온다 | 원본을 날짜 폴더 밖(`raw/<형식>/<파일>`)에 올려 sidecar 도 날짜 폴더 밖에 생김 — 파티션에 안 잡힘 | `raw/<형식>/<YYYY-MM-DD>/` 로 다시 올린다 |
| sidecar 가 아예 없다 | 스택 ① 이 `SidecarEnabled="false"`(기본), 또는 형식이 없는 일반 파일 | 질의 방식 결정을 확인하고 `"true"` 로 재배포. 켜기 전 데이터는 sidecar 가 없다(소급 스크립트 없음 — 켠 시점부터) |
| 콘솔 "저장" 이 거부 | 저장 질의(`CreateNamedQuery`)는 정책 밖 | SQL 은 파일로 둔다 |

## 끄는 법 (철거)

데이터(sidecar)는 스택 ① 소유라 남는다. 끄는 것은 스택 ③ 과 옵션 정책뿐이다.

```bash
cd ../sam/stack3-query
aws s3 rm s3://sls-<slug>-query-results-<계정ID> --recursive --profile <slug>   # 버전 관리 없는 버킷 — 비우면 지워진다
sam delete --config-file samconfig.<slug>.toml --profile <slug> --no-prompts         # 워크그룹(저장 질의 포함)·결과 버킷·Glue DB
```

Glue DB 를 지우면 그 안의 표 정의도 지워진다(실측 T2 — 배포 키 정책만으로 철거까지 된다). 그 다음 계정 관리자가 그룹
`sls-operators` 에서 `SlsAthenaAllow` 를, 실무자 Athena 를 줬다면 `sls-staff-query` 에서 `SlsStaffAthena` 를 분리하고
정책을 삭제한다. 옵션 Athena 판 `SlsGuardDeny` 는 그대로 둔다 — Allow 가 없으면 아무것도 열지 않는다(`logs/staff-sim-v2.txt` C7·C8).
컨설팅 종료 전체 순서는 `aws-iam-access.md § 종료·인계`.
