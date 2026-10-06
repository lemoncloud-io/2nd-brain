---
name: aws-opensearch
description: >
  배포 키로 배포하는 서버리스 파이프라인(S3 → Lambda → DynamoDB → Stream → Lambda → OpenSearch Serverless)
  3단계 — OpenSearch Serverless 컬렉션을 만들고 DynamoDB 변경을 색인해
  검색·집계·시계열 질의를 하는 절차(SAM 스택 ② `stack2-index` 의 배포·비용·컬렉션·매핑·질의·재색인·철거는
  이 스킬, 같은 스택의 스트림·DLQ 쪽은 `aws-dynamodb-stream`). 사용자가 "검색되게 해줘", "월별로 집계해줘",
  "인덱스 매핑 정해줘", "OpenSearch 비용이 왜 나와", "스택 ② 배포", "실무자한테 검색 읽기만 열어 줘"처럼 요청할 때,
  또는 AI 인사이트용 질의를 만들 때, 또는 배포한 계정의 OpenSearch·OCU·대시보드·실무자 검색 읽기 정책이 화제에 오르면 사용한다. 관리형 OpenSearch 도메인
  (EC2 기반)·Kibana 플러그인 개발은 다루지 않는다.
---

# AWS OpenSearch Serverless (색인 · 질의 · 시계열)

> 개념: [Amazon OpenSearch Serverless](../../../../wiki/aws-opensearch-serverless.md) — 이 스킬은 절차만 다룬다.

OpenSearch 는 전문 검색 + 집계 엔진이다. Serverless 판은 노드·샤드·버전 관리가 없고 OCU(연산 단위)
시간당 과금이다. 이 파이프라인에서는 DynamoDB 가 원본, OpenSearch 는 **질의 전용 사본** —
지워도 DynamoDB 에서 다시 만들 수 있다.

## 왜 필요한가 (설명용 한 문단)

DynamoDB 는 키로만 찾는다. "지난달 라인 A 에서 status=warn 이 몇 건인지", "'불량' 이 들어간 문서"
같은 질문은 검색·집계 엔진이 있어야 1초 안에 답한다. AI 에게 인사이트를 시키는 것도 결국
이 질의를 대신 만들어 주는 일이라, 여기까지 되면 "데이터에게 질문할 수 있는" 상태가 된다.

## 만들어지는 것 (`../sam/stack2-index/template.yaml`)

```
DynamoDB Stream ──▶ Lambda index ──_bulk──▶ OpenSearch Serverless 컬렉션 (SEARCH 타입)
                      │ 실패: bisect·재시도 3·DLQ·알람        인덱스 docs, _id = docId#version
                      └ 첫 호출에 인덱스+매핑 생성
보안 정책 3종: 암호화(AWS 소유 키) · 네트워크(public) · 데이터 접근(Lambda role + 조회 사용자)
(스택 밖) 실무자 검색 읽기: 데이터 접근 정책 <컬렉션>-read — 계정 관리자가 콘솔에서 (§ 실무자 읽기 정책)
```

- **SEARCH 타입** 고정. TIMESERIES 타입은 사용자 지정 `_id`·update·delete 가 안 되어 MODIFY/REMOVE 를 반영 못 한다.
  시계열 질의는 `@timestamp` 필드로 한다.
- `StandbyReplicas: DISABLED` — 최소 과금 절반. 운영 SLA 가 필요해지면 ENABLED.
- 네트워크 `AllowFromPublic` — 접근은 IAM SigV4 + 데이터 접근 정책으로 막는다. VPC 엔드포인트는 제한 키 정책(`ec2:*` 거부)으로 만들 수 없다.

## 매핑 (`src/transform.ts` `INDEX_BODY`)

```
문자열  → keyword (정확 일치·집계) + .text 서브필드 (전문 검색). date_detection 꺼짐 — 날짜처럼 보여도 문자열
숫자    → long / double 자동
날짜    → @timestamp · eventTime · ingestedAt 만 date (명시 매핑)
```
동적 템플릿이라 새 필드가 와도 색인된다. **한 번 정해진 필드 타입은 못 바꾼다** — 숫자 필드에
문자열이 오면 `mapper_parsing_exception` 으로 DLQ 행. 타입을 바꾸려면 새 인덱스 + 재색인.
`@timestamp` = `TIMESTAMP_FIELD`(기본 `eventTime` = 업로드 시각) → 없으면 `ingestedAt`. 문서 안 이벤트 시각으로 시계열을 보려면 `data.<필드>` 로 바꿔 배포 — 안 바꾸면 한 번에 올린 1년치 로그가 업로드 1시간에 몰린다.
질의에 쓸 필드를 미리 정해 두었으면 `INDEX_BODY.mappings.properties` 에 명시 매핑을 더한다(필드 수 상한 1,000 — 키가 값처럼 변하는 JSON 은 `enabled: false` 원문 필드로).

## 절차

`aws` 명령 전에 `export AWS_PROFILE=sls-deployer AWS_REGION=ap-northeast-2` — 기본(default) 프로파일은 다른 계정일 수 있다.

1. 스택 ① 의 `TableStreamArn`, 조회할 IAM 주체 ARN 들(계정 관리자 `admin-<이름>` + `sls-deployer`), 알람 메일을 `../sam/stack2-index/samconfig.<project>.toml`(`aws-lambda-deploy.md § 프로젝트별 설정 파일`) `parameter_overrides` 의 자리표시자에 채운다:
   `TableStreamArn="arn:..." QueryPrincipalArns="arn:aws:iam::<계정>:user/admin-<이름>,arn:aws:iam::<계정>:user/sls-deployer" CollectionName="sls-<project>-docs" AlarmEmail="<메일>"`
   (컬렉션 이름 3~26자, 소문자·숫자·하이픈 — 보안 정책 이름 `<이름>-data` 가 aoss 상한 32자 안이어야 한다.) `TimestampField`(기본 `eventTime`)는 문서에 이벤트 시각 필드가 있으면 `data.<필드>` 로.
2. 빌드·배포 (`aws-lambda-deploy` 절차). **컬렉션 생성 실측 3.5분(09-23), 최대 15분 잡는다** — CloudFormation 이 `Collection` 에서 기다린다.
3. Outputs `CollectionEndpoint` 기록. 스트림 백로그(24시간치)가 자동 색인된다 — 첫 호출 10~15초(인덱스 생성).
4. **질의 3종** — `scripts/query.ts` (SigV4 `service=aoss`, 현재 프로파일):
   ```bash
   cd ../sam/stack2-index
   COLLECTION_ENDPOINT=https://<id>.ap-northeast-2.aoss.amazonaws.com npx tsx scripts/query.ts docs
   ```
   검색(term + `.text` match) · 집계(docId 별 건수·bytes) · 시계열(`@timestamp` 1시간 histogram) 결과가 나오면 통과.
5. 대시보드: Outputs `DashboardEndpoint` 를 브라우저로 — `QueryPrincipalArns` 에 든 IAM 사용자로 콘솔 로그인 상태여야 열린다. 계정 관리자 사용자를 넣어야 관리자가 콘솔에서 자기 데이터를 본다(`sls-deployer` 는 콘솔 로그인이 없다).
   실무자(3부 `staff-*`)는 `QueryPrincipalArns` 가 아니라 `<컬렉션>-read` 로 검색만 읽는다 — 그 목록은 `aoss:*` 전권이다(§ 실무자 읽기 정책). 실무자 유형에는 대시보드가 없다.

## 질의 패턴 (AI 인사이트용 — Claude 가 이 틀로 쿼리를 만든다)

| 질문 유형 | DSL 골격 |
|---|---|
| 정확 일치 | `{"term": {"docId": "..."}}` · `{"term": {"data.status": "warn"}}` |
| 전문 검색(한글) | `{"match": {"docId.text": "설비 로그"}}` · `{"multi_match": {"query": "불량", "fields": ["*.text"]}}` |
| 기간 | `{"range": {"@timestamp": {"gte": "now-30d"}}}` |
| 그룹 집계 | `"aggs": {"by": {"terms": {"field": "data.line"}, "aggs": {"avg_temp": {"avg": {"field": "data.temp"}}}}}` |
| 시계열 | `"aggs": {"t": {"date_histogram": {"field": "@timestamp", "calendar_interval": "day"}}}` |
| 최신 버전만 | `"collapse": {"field": "docId"}` + `"sort": [{"@timestamp": "desc"}]` |

원칙: `size: 0` 으로 집계만 받는다. 결과 표를 만들어 보여주고, 원문이 필요하면 `docId` 로 DynamoDB 에서 읽는다.

## 재색인 (스트림 만료·매핑 변경·스택 ② 재생성 시)

```bash
cd ../sam/stack2-index
export AWS_PROFILE=sls-deployer AWS_REGION=ap-northeast-2
npx tsx scripts/reindex.ts <TableName> <IndexFunctionName> --dry-run   # 배치 수만 확인
npx tsx scripts/reindex.ts <TableName> <IndexFunctionName>
```
`scripts/reindex.ts` 가 테이블을 1,000행씩 스캔해 100행씩 INSERT 스트림 레코드로 꾸며 index 함수를 호출한다
(`_id = docId#version` 이라 이미 있는 행은 덮어쓴다 — 멱등). 이름 두 개는 스택 Outputs `TableName`(스택 ①)·`IndexFunctionName`(스택 ②).
**첫 실패 배치에서 멈춘다**(보낸 페이로드 파일 경로를 찍는다) — 로그의 `bulk errors` 로 독성 행을 고치고 다시 돌린다(`aws-dynamodb-stream.md § DLQ 다루기`).
함수는 배포된 `IndexName` 인덱스로 쓴다 — 새 인덱스를 채우려면 먼저 그 이름으로 배포한다.
스캔 스냅숏을 보내므로 재색인 도중 바뀐 행은 옛 값으로 덮일 수 있다 — 업로드가 없는 시간에 돌리고, 끝난 뒤 그 사이 바뀐 행이 있으면 한 번 더 돌린다(멱등).

## 매핑 변경

먼저 정말 필요한지 본다. **새 필드가 문자열·숫자면 할 일이 없다** — 동적 템플릿이 첫 문서에서 keyword(+`.text`)·long/double 로 잡는다.
새 인덱스가 필요한 경우: 기존 필드의 타입을 바꿀 때, 새 필드를 날짜·`enabled: false` 등 **동적 규칙과 다른 타입**으로 명시해야 할 때(이미 들어온 값이 있으면 그 타입이 굳어 있다).
`ensureIndex()` 는 인덱스가 **없을 때만** `INDEX_BODY` 로 만든다 — 코드만 고쳐 재배포하면 기존 인덱스에는 적용되지 않는다.

1. `src/transform.ts` `INDEX_BODY.mappings.properties` 에 필드를 더한다. `data` 아래 필드는 중첩으로: `data: { properties: { line: { type: "keyword" } } }`.
   `test/transform.test.ts` 의 `INDEX_BODY` 단언을 같이 고치고 `npx vitest run`.
2. `samconfig.<project>.toml` 의 `parameter_overrides` 문자열 끝에 ` IndexName=\"docs-v2\"` 를 더하고(파일 안에서는 다른 값처럼 `\"` 로 감싼다) `aws-lambda-deploy.md § 배포`. 이 순간부터 **새 변경은 `docs-v2` 로만** 간다 — `docs` 는 멈춘 사본.
3. 재색인(위) → `COLLECTION_ENDPOINT=... npx tsx scripts/query.ts docs-v2` 의 `total` 이 테이블 행 수(`aws dynamodb scan --table-name <T> --select COUNT`)와 같은지.
4. **질의 대상 교체** — 인덱스 이름을 쓰는 곳을 전부 `docs-v2` 로: 대시보드 인덱스 패턴, 다른 사람에게 공유한 질의 예시, `query.ts` 호출 인자, 운영 문서.
5. 옛 인덱스 삭제 — 교체가 끝난 뒤:
   `COLLECTION_ENDPOINT=... LIVE_INDEX=docs-v2 npx tsx scripts/delete-index.ts docs --yes`

2~4 사이에는 `docs` 로 질의하면 배포 이후 변경이 빠져 보인다 — 다른 사람이 대시보드를 보는 시간을 피한다.

## 실무자 읽기 정책 (`<컬렉션>-read` — 스택 밖, 계정 관리자 관리)

실무자의 조회·수정 유형(`aws-iam-access.md § 실무자 권한 유형`)에게 검색 **읽기만** 주는 데이터 접근 정책. 계정 관리자가 콘솔(OpenSearch Service → Serverless → Security → Data access policies)에서 시각 편집기로 만들고, 실무자를 더하고 빼는 것도 이 정책을 편집해서 한다 — 절차 정본은 `../../guides/03-staff-access.md` 3.4·5절. 내용은 인덱스 `index/<컬렉션>/*` 에 `aoss:ReadDocument`·`aoss:DescribeIndex`, 컬렉션 `collection/<컬렉션>` 에 `aoss:DescribeCollectionItems`, 대상은 `staff-` 사용자 ARN 뿐.

- **스택이 만들지 않는다.** stack2 템플릿은 그대로다. 그래서 스택 ② 재배포·철거와 무관하게 남는다(2026-10-02 실측 — 스택 ② 를 지운 뒤에도 남아 있었다).
- **같은 이름으로 다시 만든 컬렉션에 그대로 이어진다.** 스택 ② 를 지웠다 같은 `CollectionName` 으로 재배포하면 정책을 고치지 않아도 실무자 검색이 된다(10-02 실측). 검색 주소는 새 컬렉션 ID 로 바뀌므로 실무자에게 새 주소를 알린다 — 새 주소의 첫 호출은 `DNS resolution failure` 가 1분 안쪽으로 날 수 있다.
- **컬렉션 이름을 바꾸면 새로 만든다.** 정책이 이름을 리소스로 쥐고 있어 옛 이름의 정책은 아무 컬렉션에도 맞지 않는다 — 새 이름으로 `<새 이름>-read` 를 만들고 옛 것을 지운다. 이름은 최대 26자 + `-read` 로 32자 한도 안이다.
- 컬렉션이 없어도 만들어지고, 없는 사용자 ARN 도 검사 없이 저장된다. 대상이 빈 정책은 저장되지 않는다(마지막 한 명은 정책 삭제). 편집 반영은 실측 40~45초.
- `<컬렉션>-data`(스택 것, Lambda role·`QueryPrincipalArns` 주체 전권)는 콘솔에서 고치지 않는다 — 실무자를 넣으면 읽기 제한이 사라지고(데이터 접근 정책은 더하기만 된다), Lambda role 을 지우면 색인이 멈춘다. 다음 스택 배포가 템플릿 값으로 되돌린다.
- 배포 키도 `aoss:*` 라 이 정책을 만들 수는 있지만 만들지 않는다 — 배포 키를 지운 뒤에도 계정 관리자가 관리한다.

## 실패 모드

| 증상 | 원인 | 대응 |
|---|---|---|
| 배포 롤백: `iam:CreateServiceLinkedRole … AWSServiceRoleForAmazonOpenSearchServerless … explicit deny` | 제한 키 정책이 v1(aoss 서비스 연결 role 예외 없음) | 정책 최신본(`../policies/`)으로 갱신 — `aws-iam-access` |
| 질의 403 (계정 관리자·배포 키) | 호출 사용자가 데이터 접근 정책에 없음 | `QueryPrincipalArns` 파라미터에 넣고 재배포 |
| 실무자 검색 403 `Bad Authorization` | `<컬렉션>-read` 에 그 실무자가 없음, 또는 넣은 직후 반영 대기(실측 40~45초) | 3부 5절로 더하고 1분 뒤 다시. 이유 없는 `403 Forbidden` 이면 `awscurl` 에 `--region ap-northeast-2` 누락이거나 적재 유형 키 |
| 질의 404 `index_not_found` | 아직 한 건도 색인 안 됨 | 행을 하나 넣고 10초 |
| `mapper_parsing_exception` → DLQ | 필드 타입 충돌 | 데이터 수정 또는 § 매핑 변경 — `aws-dynamodb-stream.md § DLQ 다루기` |
| 컬렉션 생성 15분 넘김 | 리전 쪽 지연 | CloudFormation 이벤트 확인, 1시간 넘으면 삭제 후 재시도 |
| 비용이 매일 나온다 | 컬렉션은 존재만으로 OCU 과금 | 사용이 끝나면 **당일 철거** |
| 배포 롤백: 보안 정책 이름 길이 | `CollectionName` 이 26자 초과 | 짧은 이름으로 |
| 컬렉션 생성 3~4분 뒤 이벤트 소스 매핑에서 롤백 | `TableStreamArn` 자리표시자 그대로 | `samconfig.<project>.toml` 에 스택 ① Outputs 값 |

## 비용 — 이 파이프라인에서 유일하게 고정비가 있는 곳

- **단가**: 서울 OCU 시간당 **USD 0.293** — 색인·검색 같음(09-27 72분 컬렉션, 09-28 Cost Explorer: `APN2-IndexingOCU`·`APN2-SearchOCU` 각 0.0808 OCU-h → USD 0.023684, 실측).
- **월 추정** (0.293 × 730시간, 부가세·스토리지 별도):

  | 경우 | OCU | 월 USD | 하루 USD |
  |---|---|---|---|
  | 최소 — 복제본 끔, AWS 문서의 최소(색인 0.5 + 검색 0.5) | 1 | 약 214 | 약 7 |
  | 복제본 끔인데 1 + 1 로 과금되는 경우 — 09-23 CloudWatch 지표가 IndexingOCU 1.0·SearchOCU 1.0 이었다(실측) | 2 | 약 428 | 약 14 |
  | 최악 — 용량 상한 2 까지 부하가 차는 경우(색인 2 + 검색 2) | 4 | 약 855 | 약 28 |

  855 는 계정 관리자가 용량 상한을 2 로 내렸을 때만이다(`aws-account-setup` 6번) — 기본 상한 10 이면 최악 20 OCU, 월 약 USD 4,278.
  계정 소유자에게는 "켜 두면 월 214~428달러, 부하가 몰려도 상한 설정 덕에 855달러를 못 넘는다(스토리지·부가세 별도)" 로 설명한다. 어느 줄로 청구되는지는 `미검증` — 72분 실측에는 유형당 0.08 OCU-h 만 잡혀 어느 줄과도 맞지 않았다. 실제로 켜 둔 계정의 첫 달 청구서로 확정한다.
  09-24 12분 실측은 항목 자체가 없었다. 신규 계정 크레딧이 사용액을 전액 상계했다(청구 0). 템플릿은 `StandbyReplicas: DISABLED`.
- 그래서 시범 사용은 필요한 날만 만들고 지운다. 상시 운영은 "이 고정비를 낼 만큼 질의가 있는가" 를 계정 소유자가 판단.
- 대안 비교: 관리형 OpenSearch t3.small 1노드 월 USD 30 안팎(`미검증`. 단, 서버 관리·`es:*` 정책 필요) / DynamoDB 만으로 버티기(질의 포기).
- 용량 상한: 콘솔 Serverless → Dashboard → 용량 관리 → 구성. 최대 인덱싱·검색 OCU 최솟값은 **2**(기본 10, 09-24 실측). 이것은 **용량 상한**이고 위의 1 OCU 는 **과금 최소 단위**다 — 다른 값이다. 배포 키는 `aoss:UpdateAccountSettings` 거부라 계정 관리자가 `../../guides/01-aws-account-setup.md` § 3.6 에서 내린다. 이 계정 상한은 **컬렉션 그룹에 속하지 않은 컬렉션에만** 적용된다 — 그룹은 자기 최소·최대(최대 미지정 시 96)를 가지므로 배포 키는 `aoss:CreateCollectionGroup`·`UpdateCollectionGroup` 도 거부다(정책 v5). 스택 ② 의 컬렉션은 그룹 없이 만들어져 계정 상한을 따른다(09-29 실측 `batch-get-collection`).

## 철거

`../sam/stack2-index` 에서 `sam delete --config-file samconfig.<project>.toml --profile sls-deployer --no-prompts` — 컬렉션·정책·Lambda·DLQ 전부. **스택 ① 보다 먼저.** 삭제 후 과금이 몇 분 안에 멈추는지는 `미검증`(09-27 실측은 다음 날 Cost Explorer 로만 확인) — 사용 종료 전체 순서와 마지막 청구 확인은 `aws-iam-access.md § 사용 종료·정리`.

단 실무자 읽기 정책 `<컬렉션>-read` 는 스택 밖이라 남는다(과금 없음). 같은 이름으로 다시 켤 계획이면 그대로 두고, 실무자 검색도 더는 안 쓸 때는 계정 관리자가 콘솔 Data access policies 에서 그 정책을 열어 **삭제**(확인 칸에 `확인`)하거나 `aws opensearchserverless delete-access-policy --type data --name <컬렉션>-read --profile <admin-profile>`.
