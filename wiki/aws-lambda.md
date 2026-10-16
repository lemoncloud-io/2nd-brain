---
type: tool
topics:
  - aws-serverless
status: draft
sources:
  - "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html"
  - "https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html"
  - "https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html"
  - "https://docs.aws.amazon.com/lambda/latest/dg/lambda-typescript.html"
  - "https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html"
  - "https://docs.aws.amazon.com/lambda/latest/dg/invocation-async.html"
  - "https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html"
  - "https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-configuring.html"
  - "https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-retain-records.html"
  - "https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html"
  - "https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-params.html"
  - "https://docs.aws.amazon.com/lambda/latest/dg/services-dynamodb-errors.html"
  - "https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html"
  - "https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html"
  - "https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-function.html"
  - "[[projects/aws-serverless/README|aws-serverless]]"
  - "[[projects/aws-serverless/guides/policy-design|정책 설계 근거]]"
created: "2026-10-06"
updated: "2026-10-06"
---

# AWS Lambda

## Summary

AWS Lambda는 서버를 준비하거나 관리하지 않고 이벤트가 올 때마다 함수(handler) 하나를 실행하는 서버리스 컴퓨팅 서비스다.
서버 유지보수·용량·스케일링·패치는 AWS가 맡는다. 이 파이프라인에는 함수가 두 개 있다. S3 업로드를 받아 DynamoDB에 행을 쓰는
**ingest**, DynamoDB Stream을 받아 OpenSearch Serverless에 색인하는 **index**다.

- **과금 구조** — 요청 건수와 실행 시간(GB-초 = 설정 메모리 × 실행 시간)으로 낸다. 켜 두는 비용은 없다. 단가는 여기 적지 않는다.
  CPU는 설정 메모리에 비례해 배정된다(1,769 MB에서 vCPU 1개 상당).
- **런타임** — 이 파이프라인은 `nodejs22.x`(Amazon Linux 2023)와 TypeScript를 쓴다. Node.js는 TypeScript를 바로 실행하지 못하므로
  JavaScript로 변환해 올리고, AWS SAM은 이 변환에 esbuild를 쓴다. esbuild는 타입 검사를 하지 않아 `tsc --noEmit`을 따로 돌린다.

| 주요 한도 | 기본값 |
|---|---|
| 최대 실행 시간(timeout) | 900초(15분) |
| 메모리 | 128 MB ~ 10,240 MB, 1 MB 단위 |
| 호출 페이로드 — 동기 | 요청·응답 각 6 MB |
| 호출 페이로드 — 비동기 | 1 MB |
| 배포 패키지(.zip) | 압축 해제 기준 250 MB(레이어 포함) |
| 동시 실행 | 리전당 1,000. 새 계정은 동시 실행·메모리 한도가 더 낮게 시작하고 사용량에 따라 자동으로 오른다 |

## Use Cases

### S3 이벤트 → ingest (비동기 호출)

S3는 Lambda를 **비동기**로 호출한다. Lambda는 이벤트를 큐에 넣고 바로 성공을 돌려준 뒤, 별도 프로세스가 큐에서 꺼내 함수를 실행한다. 그래서 함수가 실패해도 업로드한 쪽에는 드러나지 않는다.

- **재시도** — 함수 오류(코드 예외, 타임아웃 같은 런타임 오류 포함)가 나면 기본으로 2회 더 시도한다. 첫 실패 뒤 1분, 두 번째 실패 뒤 2분을 기다린다.
  재시도 횟수는 0~2, 이벤트 최대 보관 시간은 최대 6시간까지 조정할 수 있다. 스로틀(429)·시스템 오류(5xx)는 기본 최대 6시간 동안 다시 큐에 넣어 시도한다.
- **OnFailure 대상** — 재시도를 다 쓰거나 보관 시간이 지난 이벤트는 버려진다. 남기려면 on-failure destination(SQS·SNS·S3·Lambda·EventBridge)이나
  DLQ(SQS·SNS)를 건다. destination 레코드에는 원본 이벤트(`requestPayload`)와 응답(`responseContext`·`responsePayload`)이 함께 들어가고, DLQ에는 이벤트 본문만 간다.
- **중복** — 오류가 없어도 같은 이벤트가 두 번 이상 올 수 있다(큐가 최종 일관성). 함수는 멱등이어야 한다.
- **권한** — S3가 함수를 부르려면 함수의 리소스 기반 정책에 S3 허용이 있어야 한다. SAM S3 이벤트가 만드는 `s3.amazonaws.com` 권한은 배포 키 정책을 통과한다([[projects/aws-serverless/guides/policy-design|정책 설계 근거]]).
- **재귀 주의** — 함수가 자기를 트리거하는 버킷에 다시 쓰면 반복 호출된다. ingest는 S3를 읽기만 하고(`s3:GetObject`·`s3:GetObjectVersion`) DynamoDB에 쓴다.

이 파이프라인은 `EventInvokeConfig`에 `MaximumRetryAttempts: 2`와 `OnFailure` → SQS `<S>-ingest-dlq`(보존 14일)를 건다. DLQ 깊이가 0보다 크면 CloudWatch 알람이 SNS 이메일을 보낸다. 멱등은 `attribute_not_exists(docId)` 조건부 `PutItem`으로 맞춘다.

### DynamoDB Stream → index (이벤트 소스 매핑)

Stream은 이벤트 소스 매핑(event source mapping)으로 연결한다. Lambda가 샤드를 초당 4회 폴링하고, 레코드가 있으면 배치로 함수를 호출해 결과를 기다린다.

| 설정 | AWS 기본값·범위 | 이 파이프라인 |
|---|---|---|
| `BatchSize` | 기본 100, 최대 10,000 | 100 (배치당 `_bulk` 1회) |
| `MaximumBatchingWindowInSeconds` | 기본 0, 최대 5분까지 모음(배치 페이로드 6 MB 상한) | 5 |
| `BisectBatchOnFunctionError` | 기본 false | true |
| `MaximumRetryAttempts` | 기본 -1(레코드 만료까지 무한), 0~10,000 | 3 |
| `MaximumRecordAgeInSeconds` | 기본 -1(무한), 최대 604,800 | 지정 안 함 |
| `DestinationConfig.OnFailure` | SQS·SNS·S3 | SQS `<S>-index-dlq` |
| `StartingPosition` | `TRIM_HORIZON` 또는 `LATEST` | `TRIM_HORIZON` |

- 함수가 오류를 내면 Lambda는 레코드가 만료되거나 최대 나이·재시도 횟수에 닿을 때까지 다시 시도하고, 그동안 그 샤드 처리가 막힌다. 기본값 그대로면 독성 레코드 하나가 샤드를 최대 하루 막는다(DynamoDB Streams 보존 24시간).
- `BisectBatchOnFunctionError`는 실패 배치를 반으로 쪼개 문제 레코드를 격리한다. 쪼개기는 재시도 횟수를 쓰지 않는다.
- SQS·SNS로 가는 실패 레코드에는 **레코드 본문이 없다**. `DDBStreamBatchInfo`(샤드 ID·시퀀스 번호·`batchSize`)만 들어 있어 원인은 함수 로그로 보고,
  24시간이 지나면 DynamoDB를 다시 읽어 재색인한다([[projects/aws-serverless/config/skills/aws-dynamodb-stream|aws-dynamodb-stream]] § DLQ 다루기).
- `LATEST`는 매핑 생성·갱신 중 레코드를 놓칠 수 있어 `TRIM_HORIZON`을 쓴다. 처리는 최소 1회라 중복이 생길 수 있고, 색인 `_id = docId#version`으로 멱등을 맞춘다.

## Setup Notes

설치·배포 절차는 스킬에 있다. 여기에는 템플릿에 들어 있는 값만 적는다.

| 항목 | ingest (`config/sam/stack1-ingest`) | index (`config/sam/stack2-index`) |
|---|---|---|
| 런타임·아키텍처 | `nodejs22.x` · `arm64` | 같음 |
| `Timeout` · `MemorySize` | 30초 · 256 MB | 60초 · 512 MB |
| 번들 | esbuild `Format: cjs` · `Target: es2022` · `Minify: true` | 같음 |
| 트리거 | S3 `s3:ObjectCreated:*` | DynamoDB Stream (위 표) |
| 실패 처리 | 비동기 재시도 2 → SQS DLQ | 재시도 3 + bisect → SQS DLQ |
| 로그 그룹 | `/aws/lambda/<함수명>`, 보존 14일 | 같음 |

- **실행 역할** — 함수가 AWS 서비스에 접근할 때 쓰는 IAM role이다. Lambda가 호출 때 이 role을 assume 하고, 신뢰 정책 주체는 `lambda.amazonaws.com`이다. 템플릿에 `Role:`이 없어서 SAM이 `<함수 논리 ID>Role`을 만들고 `Policies:`(ingest `DynamoDBWritePolicy`, index `aoss:APIAccessAll`·`sqs:SendMessage` 등)를 그 role에 붙인다.
- **권한 상한(permissions boundary)** — 관리형 정책으로 role이 가질 수 있는 최대 권한을 정한다. 스스로 권한을 주지는 않는다. 실효 권한은 role 정책과 바운더리의 교집합이고, 어느 쪽이든 명시 거부가 이긴다.
  `Globals.Function.PermissionsBoundary`가 모든 함수 role에 `SlsLambdaBoundary`를 붙인다. 이 바운더리는 s3·dynamodb·aoss·logs·sqs·sns·cloudwatch만 허용하고 비용 폭탄·공개 노출·외부 공유·서울 밖 리전을 거부한다. 인라인 정책에 무엇을 적어도 실효 권한은 이 범위 안이다.
- **배포 키와의 관계** — 배포 키 `sls-deployer`는 이름이 `role/sls-*`이고 이 바운더리가 붙은 role만 만들 수 있다. SAM role 이름은 스택명으로 시작하므로 스택 이름은 `sls-`로 시작해야 하고, 바운더리가 빠지면 role 생성이 `AccessDenied`로 거부되어 롤백된다.
- 콘솔에서 함수 코드를 직접 고치지 않는다. 다음 `sam deploy`가 덮어쓴다.
- 빌드·배포·로그·롤백 공통: [[projects/aws-serverless/config/skills/aws-lambda-deploy|aws-lambda-deploy]]. ingest 장애 진단: [[projects/aws-serverless/config/skills/aws-s3-ingest|aws-s3-ingest]]. index 매핑·DLQ: [[projects/aws-serverless/config/skills/aws-dynamodb-stream|aws-dynamodb-stream]].

## Related Concepts

- [[wiki/serverless-data-pipeline|서버리스 데이터 파이프라인]] — 두 함수가 놓인 전체 흐름
- [[wiki/aws-s3|Amazon S3]] — ingest를 깨우는 ObjectCreated 이벤트의 출처
- [[wiki/aws-dynamodb|Amazon DynamoDB]] — ingest의 쓰기 대상이자 index의 Stream 원천
- [[wiki/aws-opensearch-serverless|Amazon OpenSearch Serverless]] — index의 `_bulk` 대상
- [[wiki/aws-iam|AWS IAM]] — 실행 역할, permissions boundary, 배포 키 정책
- [[wiki/aws-sam|AWS SAM]] — 함수·역할·트리거를 한 템플릿으로 배포

## Open Questions

- `nodejs22.x` 지원 종료 예정일은 2027-04-30(함수 생성 차단 2027-06-01, 갱신 차단 2027-07-01 — AWS가 계획용으로 공표한 날짜라 바뀔 수 있다). 그 전에 런타임을 올려야 하고, 이 파이프라인에서 `nodejs24.x` 동작은 `미검증`.
- index는 부분 배치 응답(`FunctionResponseTypes: ReportBatchItemFailures`)을 쓰지 않고 배치 재시도 + bisect로 처리한다. 도입 여부는 정하지 않았다.
- ingest 실패 경로(재시도 2회 → DLQ → 알람)는 실측 기록이 없다(`미검증`, [[projects/aws-serverless/config/skills/aws-s3-ingest|aws-s3-ingest]] § 검증 체크). DLQ 메시지의 `requestPayload`로 재처리하는 절차도 AWS 문서 기준이고 실측은 `미검증`.
- 공개본 이름(`Sls*`·`sls-`)으로는 실계정 재실측 전이다(`미검증`, [[projects/aws-serverless/README|aws-serverless]] § Status).
