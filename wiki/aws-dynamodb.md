---
type: tool
topics:
  - aws-serverless
status: draft
sources:
  - "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html"
  - "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html"
  - "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ServiceQuotas.html"
  - "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html"
  - "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html"
  - "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html"
  - "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.Lambda.html"
  - "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html"
  - "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html"
  - "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/OpenSearchIngestionForDynamoDB.html"
  - "[[projects/aws-serverless/README|aws-serverless]]"
created: "2026-10-06"
updated: "2026-10-06"
---

# Amazon DynamoDB

## Summary

Amazon DynamoDB 는 서버와 용량 계획 없이 쓰는 관리형 NoSQL 데이터베이스다. **테이블(table)** 은 **항목(item)** 의 모음이고,
항목은 **속성(attribute)** 의 모음이다(RDB 의 행·열에 해당). 기본 키 말고는 스키마가 없어 항목마다 속성이 달라도 된다.

### 기본 키 — 파티션 키와 정렬 키

기본 키는 **파티션 키만** 쓰거나 **파티션 키 + 정렬 키(복합 키)** 를 쓴다. 복합 키에서는 파티션 키가 같아도 정렬 키가 다르면
다른 항목이고, 파티션 키가 같은 항목들은 정렬 키 순서로 함께 저장된다. 키 속성은 문자열·숫자·바이너리 스칼라만 되고,
값 길이는 파티션 키 1–2,048 바이트, 정렬 키 1–1,024 바이트다.

이 파이프라인은 복합 키다: **PK `docId` = S3 객체 키, SK `version` = S3 versionId**(버저닝이 없으면 `"null"`). 파일 하나가 `docId`
하나이고, 다시 올릴 때마다 `version` 이 다른 항목이 쌓여 이력이 된다. S3 키는 최대 1,024 바이트라 파티션 키 한도 안에 든다.

### 항목 최대 크기

항목 하나는 **최대 400 KB** 이고, 값뿐 아니라 **속성 이름 길이도 포함**된다(UTF-8 바이트). 그래서 큰 원본은 S3 에 두고 테이블에는
메타데이터만 둔다. 행 속성은 `docId · version · bucket · size · etag · eventTime · eventName · ingestedAt` 이고, 256 KB 이하
`application/json` 객체만 본문을 `data` 로 인라인한다(`stack1-ingest/src/transform.ts` `MAX_INLINE_JSON_BYTES`).

### 온디맨드 용량

온디맨드(`PAY_PER_REQUEST`)는 요청 단위로 과금하고, 트래픽이 없으면 처리량 요금이 0 이다. AWS 문서가 기본·권장으로 두는 모드다.
쓰기 요청 단위 1개 = 1 KB 이하 항목 쓰기 1회, 읽기 요청 단위 1개 = 4 KB 이하 항목 강한 일관성 읽기 1회(최종 일관성이면 2회)라서
항목이 클수록 요청 단위를 더 쓴다. 새 테이블은 초당 쓰기 4,000·읽기 12,000 까지 바로 받고 이전 최고치의 두 배까지 즉시 확장되지만,
**30분 안에 이전 최고치의 두 배를 넘기면 스로틀링**될 수 있다. 테이블당 기본 한도는 읽기·쓰기 각 40,000 요청 단위/초(조정 가능)다.

### 조건부 쓰기로 멱등

`PutItem` 은 기본적으로 같은 기본 키 항목을 **덮어쓴다**. `attribute_not_exists(docId)` 조건을 붙이면 DynamoDB 는 요청 키로
식별되는 항목 하나에 조건을 평가한다. 복합 키 테이블이면 `docId`·`version` **두 값 모두**로 식별되는 항목이다. 그 항목이 없을
때만 쓰고, 있으면 "The conditional request failed" 로 거부한다(SDK 에서는 `ConditionalCheckFailedException`).

ingest 는 이 예외를 `skipped` 로 세고 `already-ingested` 로그만 남긴다(`stack1-ingest/src/ingest.ts`). S3 이벤트가 두 번 오거나
Lambda 가 재시도해도 같은 행이 다시 쓰이지 않고 MODIFY 스트림도 생기지 않는다. 다른 오류는 던져서 재시도 2회 → DLQ 경로를 탄다.

### Streams

DynamoDB Streams 는 항목 단위 변경(INSERT·MODIFY·REMOVE)을 시간 순 로그로 **최대 24시간** 보관한다. 각 레코드는 스트림에
**정확히 한 번** 나타나고, 같은 항목의 변경은 실제 순서대로 나온다(순서 보장은 항목 단위). `StreamViewType` 은 `KEYS_ONLY`(키만) ·
`NEW_IMAGE`(변경 후 전체) · `OLD_IMAGE`(변경 전 전체) · `NEW_AND_OLD_IMAGES`(전·후 모두 — 이 파이프라인) 넷이다.

- **설정 후에는 `StreamViewType` 을 바꿀 수 없다.** 스트림을 끄고 새로 만들어야 하고, 그러면 스트림 ARN 이 새로 생긴다.
- 데이터를 바꾸지 않는 `PutItem`·`UpdateItem` 은 스트림 레코드를 만들지 않는다. 같은 값으로 덮어써서는 재색인되지 않는다.
- Lambda 는 스트림을 초당 4번 폴링한다. 한 스트림에 Lambda 함수를 셋 이상 붙이면 읽기 스로틀링이 날 수 있다(최대 2개 권장).
- 함수가 오류를 내면 Lambda 는 성공하거나 레코드가 만료될 때까지 배치를 재시도한다. 재시도 제한·배치 분할은 따로 설정한다.

### 검색·집계를 OpenSearch 로 넘기는 이유

DynamoDB 읽기는 키 중심이다. `Query` 는 파티션 키 값 하나를 반드시 받고 정렬 키 조건으로만 좁힌다. 키가 아닌 속성(`size`,
`eventTime`, `data.*`)이나 본문 문자열로 찾으려면 `Scan` 인데, `Scan` 은 **모든 항목을 읽고** 호출당 1 MB 씩 페이지를 넘기며,
필터식이 읽은 **뒤에** 적용돼 필터를 걸어도 소비 용량이 같다. 보조 인덱스(GSI, 테이블당 기본 20개)는 접근 패턴마다 미리 만들어야 한다.

그래서 역할을 나눈다: **DynamoDB = 원본 메타데이터 저장(키 조회), OpenSearch = 검색·집계·시계열.** 키가 아닌 필드로 자주 찾으면
GSI 대신 OpenSearch 질의로 푼다([[projects/aws-serverless/config/skills/aws-dynamodb-stream|aws-dynamodb-stream]] § 테이블 설계 규칙).
AWS 는 DynamoDB → OpenSearch zero-ETL 통합(OpenSearch Ingestion)도 제공한다. 이 통합은 export 스냅숏과 Streams
(`NEW_AND_OLD_IMAGES`)를 쓰고 PITR 이 켜져 있어야 한다. 이 파이프라인은 대신 Stream → Lambda index → `_bulk` 로 직접 색인한다.

## Use Cases

- **문서 메타데이터 원장** — 파일 버전 하나당 한 행. `docId` 로 `Query` 하면 그 파일의 업로드 이력이 정렬 키 순으로 나온다.
- **변경 이벤트의 출처** — Stream 이 [[wiki/aws-lambda|AWS Lambda]] index 를 깨워 [[wiki/aws-opensearch-serverless|OpenSearch Serverless]] 에
  반영한다. INSERT·MODIFY 는 색인, REMOVE 는 삭제(`_id = docId#version`).
- **재색인의 원천** — 스트림 보존 24시간을 넘겼거나 인덱스를 새로 만들 때 테이블을 `Scan` 해 다시 채운다
  ([[projects/aws-serverless/config/skills/aws-opensearch|aws-opensearch]] § 재색인).

## Setup Notes

설치 절차는 스킬에 있다. 여기에는 설정값만 적는다(`projects/aws-serverless/config/sam/stack1-ingest`·`stack2-index` 의 `template.yaml`).

| 항목 | 이 파이프라인의 값 |
|---|---|
| 테이블 · 키 | `<스택명>-docs` · `docId` (S, HASH) + `version` (S, RANGE) |
| 용량 · Stream · PITR | `PAY_PER_REQUEST` · `NEW_AND_OLD_IMAGES` · `false`(시험 단계, 운영 전환 시 켠다 — 스킬 기준) |
| ingest 쓰기 | `PutItem` + `ConditionExpression: attribute_not_exists(docId)`, role 정책 `DynamoDBWritePolicy` |
| 스트림 소비 (stack2) | `TRIM_HORIZON` · `BatchSize: 100` · `MaximumBatchingWindowInSeconds: 5` · `BisectBatchOnFunctionError: true` · `MaximumRetryAttempts: 3` · 실패 시 SQS DLQ |
| 스택 연결 | stack1 Outputs `TableStreamArn` 을 stack2 **파라미터**로 붙여넣는다(ImportValue 아님) |

- 테이블을 다시 만들면 스트림 ARN 이 바뀐다 — stack1 Outputs 를 다시 복사해 stack2 를 재배포한다. 철거는 **stack2 먼저**다.
- 배포 키는 DynamoDB 글로벌 테이블·복제본, 예약 용량 구매, PITR export, 교차 계정 공유(리소스 정책)를 거부한다
  ([[projects/aws-serverless/guides/policy-design|policy-design]]).
- 실측(옛 리소스 이름): 파일 1개 업로드 후 12초 안에 1행(README § 검증 메모). 온디맨드 단가는 스킬에서도 `미검증` — 비용은 Budgets·Cost Explorer 로 본다.
- 테이블·스트림·DLQ: [[projects/aws-serverless/config/skills/aws-dynamodb-stream|aws-dynamodb-stream]] ·
  테이블을 만드는 stack1: [[projects/aws-serverless/config/skills/aws-s3-ingest|aws-s3-ingest]] ·
  빌드·롤백: [[projects/aws-serverless/config/skills/aws-lambda-deploy|aws-lambda-deploy]].

## Related Concepts

- [[wiki/serverless-data-pipeline|Serverless Data Pipeline]] — DynamoDB 가 저장과 색인의 경계인 전체 흐름.
- [[wiki/aws-s3|Amazon S3]] — `docId`·`version` 의 출처. 원본은 S3 에 남고 테이블에는 메타데이터만 둔다.
- [[wiki/aws-lambda|AWS Lambda]] — ingest(쓰기)와 index(스트림 소비). 스트림 배치 실패는 bisect + 재시도 3 + DLQ 로 격리한다.
- [[wiki/aws-opensearch-serverless|OpenSearch Serverless]] — 키가 아닌 필드 검색·집계 담당. `_id = docId#version` 이라 재색인도 멱등이다.
- [[wiki/aws-iam|AWS IAM]] — ingest 쓰기 정책, index 의 스트림 읽기(`AWSLambdaDynamoDBExecutionRole`), 배포 키의 DynamoDB Deny.
- [[wiki/aws-sam|AWS SAM]] — 테이블·스트림·이벤트 소스 매핑을 템플릿으로 만든다.

## Open Questions

- JSON 텍스트 크기와 DynamoDB 의 Map 속성 크기 계산은 같지 않다. 256 KB 근처 JSON 이 다른 속성과 합쳐 항상 400 KB 안에 드는지
  `미검증`. 넘으면 `PutItem` 이 실패해 재시도 2회 뒤 DLQ 로 간다.
- 템플릿에 항목 만료(TTL) 설정이 없어 버전 행이 계속 쌓인다. S3 이전 버전을 지울 때 행도 정리할지 정해지지 않았다.
- PITR 을 켜는 시점은 "운영 전환 시"로만 적혀 있다. zero-ETL 통합 대신 Lambda 로 직접 색인한 근거도 프로젝트 문서에 없다.
