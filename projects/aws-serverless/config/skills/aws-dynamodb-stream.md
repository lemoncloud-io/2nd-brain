---
name: aws-dynamodb-stream
description: >
  서버리스 파이프라인 2단계 — DynamoDB 테이블 설계(키·온디맨드)와 Stream → Lambda
  연결로 테이블 변경을 OpenSearch에 실시간 반영하는 절차(SAM 스택 ② `stack2-index` 의 스트림·이벤트 소스
  매핑·DLQ 쪽은 이 스킬, 같은 스택의 배포·비용·컬렉션·매핑·질의는 `aws-opensearch`). 사용자가 "테이블
  설계해줘", "DDB 바뀌면 검색에 반영되게", "스트림이 안 흘러", "DLQ에 뭐가 쌓였어"처럼 요청할 때, 또는
  이 파이프라인의 DynamoDB·스트림이 화제에 오르면 사용한다. RDB·SQL·GSI 설계 일반론은 다루지 않는다.
---

# AWS DynamoDB + Stream (테이블 설계 · 변경 스트림 → Lambda)

DynamoDB는 "키로 넣고 키로 꺼내는" 관리형 NoSQL이다. 서버·용량 계획 없이 온디맨드로 쓴 만큼 낸다.
**Stream** 을 켜면 모든 INSERT·MODIFY·REMOVE 가 24시간 보관되는 변경 로그로 나오고, Lambda가
그걸 받아 OpenSearch에 색인한다. 그래서 DynamoDB는 "원본 저장", OpenSearch는 "검색·집계" —
역할이 나뉜다.

## 왜 RDB가 아닌가 (설명용 한 문단)

지금 단계의 문제는 "데이터를 모아서 찾아보고 집계하는 것"이지 트랜잭션·조인이 아니다.
RDB는 서버가 항상 켜져 있고(최소 인스턴스 월 수만 원부터, `미검증`), 스키마를 먼저 확정해야 한다. DynamoDB는
행마다 필드가 달라도 되고, 쓰지 않으면 0원이며, 변경이 스트림으로 흘러나와 다음 단계가
자동으로 붙는다. 조인·복잡한 SQL이 정말 필요해지는 시점에 RDB를 더하면 된다 — 그때 판단한다.

## 테이블 설계 규칙 (이 파이프라인)

| 항목 | 값 | 이유 |
|---|---|---|
| PK | `docId` (S) = S3 객체 키 | 파일 하나 = 문서 하나. 경로가 곧 분류(`자료/설비/...`) |
| SK | `version` (S) = S3 versionId, 버저닝 없으면 `"null"` | 같은 파일 재업로드 이력 보존. 재실행해도 같은 키 = 멱등 |
| 과금 | `PAY_PER_REQUEST` | 트래픽 예측 불가. 월 수백만 요청 전까지 프리티어·소액 |
| Stream | `NEW_AND_OLD_IMAGES` | REMOVE 도 키를 알아야 OpenSearch에서 지운다 |
| PITR | 시험 단계 off | 운영 전환 시 on (월 GB당 USD 0.2 안팎, `미검증`) |
| 나머지 필드 | 자유 (`size`·`eventTime`·`data{...}`·`tag`…) | 스키마 없음. 색인 매핑은 OpenSearch 쪽에서 정한다 |

**설계 순서:** 질문 목록 → 접근 패턴("무엇으로 찾나") → 키. 키가 아닌 필드로 자주 찾아야 하면
GSI 를 만들지 말고 OpenSearch 쿼리로 푼다 — 그게 이 파이프라인의 분업이다.

## Stream → Lambda 연결 (템플릿 `stack2-index`)

```yaml
Events:
  TableStream:
    Type: DynamoDB
    Properties:
      Stream: !Ref TableStreamArn          # 스택 ① Outputs 값을 파라미터로 붙여넣기
      StartingPosition: TRIM_HORIZON       # 스트림에 남은 24시간치부터 (LATEST 면 배포 이전 것 유실)
      BatchSize: 100                       # _bulk 한 번
      MaximumBatchingWindowInSeconds: 5    # 소량이어도 5초 안에 색인
      BisectBatchOnFunctionError: true     # 실패 배치를 반으로 쪼개 독성 레코드만 격리
      MaximumRetryAttempts: 3
      DestinationConfig:
        OnFailure: { Destination: !GetAtt IndexDlq.Arn }
```

SAM이 `AWSLambdaDynamoDBExecutionRole` 을 role 에 붙이고(스트림 읽기), DLQ 로 보내는 `sqs:SendMessage` 는 템플릿 인라인 문이 준다.
이름(스택명 = `<S>`): DLQ `<S>-index-dlq`(보존 14일) · 알람 `<S>-index-dlq-not-empty` · Outputs `IndexFunctionName`·`DlqUrl`·`IndexName`.

## 절차

`aws` 명령 전에 `export AWS_PROFILE=sls-deployer AWS_REGION=ap-northeast-2` — 기본(default) 프로파일은 다른 계정일 수 있다.

1. 스택 ① 배포 완료 → Outputs `TableStreamArn` 복사.
2. `../sam/stack2-index/samconfig.<project>.toml`(`aws-lambda-deploy.md § 프로젝트별 설정 파일`)의 `parameter_overrides` 에 `TableStreamArn="arn:aws:dynamodb:...:table/<t>/stream/<ts>"`.
3. 배포는 `aws-opensearch` 스킬 절차(컬렉션이 같은 스택에 있다).
4. **흐름 확인** — 테이블에 직접 행을 넣고 색인되는지:
   ```bash
   T=<테이블>
   aws dynamodb put-item --table-name $T --item '{"docId":{"S":"manual/test"},"version":{"S":"1"},"size":{"N":"1"},"ingestedAt":{"S":"2026-01-01T00:00:00Z"}}'
   aws dynamodb update-item --table-name $T --key '{"docId":{"S":"manual/test"},"version":{"S":"1"}}' --update-expression 'SET tag = :t' --expression-attribute-values '{":t":{"S":"reviewed"}}'
   aws dynamodb delete-item --table-name $T --key '{"docId":{"S":"manual/test"},"version":{"S":"1"}}'
   ```
   10초 뒤 OpenSearch 에서 `manual/test#1` 이 생겼다 → `tag` 붙었다 → 사라졌다 세 단계.
5. **매핑 상태**:
   ```bash
   aws lambda list-event-source-mappings --function-name <index 함수> \
     --query 'EventSourceMappings[].[State,LastProcessingResult]' --output text
   ```
   `Enabled OK` 가 정상. `PROBLEM: Function call failed` 는 마지막 배치 실패 — DLQ 를 본다.

## DLQ 다루기 (알람 `<S>-index-dlq-not-empty` 가 울렸을 때)

DLQ 메시지 하나 = 재시도 3회 + bisect 끝에 포기한 **배치 하나**(`batchSize` 가 1 이면 독성 레코드 하나). 메시지 수 ≠ 문제 행 수다.
매핑이 `Enabled OK` 로 보여도 DLQ 는 찰 수 있다 — bisect 가 독성 레코드를 떼어 내고 스트림은 계속 흐른다(실측).

1. **원인 확인 — 로그가 유일한 근거다.** DLQ 메시지에는 위치만 있고(`DDBStreamBatchInfo.startSequenceNumber`·`shardId`·`batchSize`) 레코드 본문도 `docId` 도 없다.
   ```bash
   export AWS_PROFILE=sls-deployer AWS_REGION=ap-northeast-2
   F=<IndexFunctionName>; Q=<DlqUrl>          # 스택 ② Outputs — 스택 ① 에도 DlqUrl 이 있으니 헷갈리지 않는다
   aws sqs get-queue-attributes --queue-url $Q --attribute-names ApproximateNumberOfMessages
   aws logs tail /aws/lambda/$F --since 1d | grep -E 'bulk errors|ERROR|Task timed out' | tail -20
   ```
   `bulk errors: [...]` 에 실패한 `_id`(`docId#version`)와 사유가 **배치당 앞 3건만** 찍힌다(`src/index.ts`). 403·타임아웃은 `bulk errors` 가 아니라 `ERROR` 줄로 나온다. 같은 배치가 재시도되며 같은 줄이 반복되니 `sort -u` 로 본다. 로그 보존은 14일.
   `mapper_parsing_exception` 은 대개 명시 매핑 필드(`size` long, `eventTime`·`ingestedAt`·`@timestamp` date)에 맞지 않는 값이다.

   | 로그 사유 | 원인 | 고치는 곳 |
   |---|---|---|
   | `mapper_parsing_exception` | 필드 타입 충돌(숫자 필드에 문자열, 날짜 아닌 값이 날짜 필드에) | 데이터 수정, 또는 새 인덱스(`aws-opensearch.md § 매핑 변경`) — **기존 인덱스의 필드 타입은 넓힐 수 없다** |
   | `403` / `security_exception` | 컬렉션 데이터 접근 정책에 함수 role 이 없다 | 스택 ② 재배포(수동 변경 되돌리기) |
   | `429` · `Task timed out` | 컬렉션 과부하·용량 상한 | 잠시 뒤 재처리. 반복되면 용량 상한(`aws-account-setup` 6번) |
   | `COLLECTION_ENDPOINT env var missing` | 환경 변수 누락 | 재배포 |

2. **고친다.** 데이터가 원인이면 테이블의 그 행을 고친다(`update-item`) — **값이 실제로 바뀌면 MODIFY 스트림이 생겨 자동 재색인된다**(같은 값으로 덮으면 이벤트가 없다). 따로 invoke 하지 않는다.
   매핑이 원인이면 `aws-opensearch.md § 매핑 변경` 절차(새 인덱스 + 재색인).
3. **빠진 문서가 남았는지 확인하고 채운다.** 로그의 앞 3건 밖 레코드도 빠졌을 수 있다 — 테이블 행 수(`aws dynamodb scan --table-name <TableName> --select COUNT`)와 `query.ts` 의 `total`(`aws-opensearch.md § 절차` 4 — `COLLECTION_ENDPOINT`·인덱스 이름 인자)을 비교한다.
   인덱스가 **적으면** `aws-opensearch.md § 재색인`. **많으면** REMOVE 가 DLQ 로 가서 지워지지 않은 문서다 — 재색인은 INSERT 만 보내므로 못 고친다. 새 인덱스(`aws-opensearch.md § 매핑 변경` 2~5, 매핑은 그대로)로 다시 채운다.
   재색인은 첫 실패 배치에서 멈추므로 **독성 행을 먼저 고친 뒤** 돌린다. DLQ 메시지가 24시간보다 오래됐으면 시퀀스 번호로는 레코드를 못 찾는다(스트림 보존 24시간) — 이때도 재색인이 답이다.
   시퀀스 번호로 `get-records` 한 옛 이미지를 다시 `invoke` 하지 않는다 — 그 뒤 바뀐 행을 옛 상태로 덮어쓸 수 있다.
4. **비운다 — 재처리가 끝난 뒤에만.** 전부 처리했으면 `aws sqs purge-queue --queue-url $Q`. 메시지를 들여다봐야 하면
   `aws sqs receive-message --queue-url $Q --max-number-of-messages 10 --visibility-timeout 300 --query 'Messages[].[ReceiptHandle,Body]' --output text`
   (한 번에 최대 10개, 받은 메시지는 5분간 안 보인다 — 알람이 잠깐 OK 로 보여도 해결된 게 아니다). 큐가 비면 1분 안에 알람이 `OK` 로 돌아간다.

## 실패 모드

| 증상 | 원인 | 대응 |
|---|---|---|
| 배포 뒤 아무것도 색인 안 됨, `No records processed` | 첫 폴링 대기(최대 1분) 또는 `LATEST` 로 배포 | 1분 기다림 / `TRIM_HORIZON` |
| 같은 문서가 두 번 색인 | 재시도 | 정상 — `_id = docId#version` 이라 덮어쓴다(멱등). 스택 ① ingest 도 조건부 Put(`../sam/stack1-ingest/src/ingest.ts`)이라 재시도가 MODIFY 를 만들지 않는다 |
| 한 레코드 때문에 뒤가 다 밀림 | 템플릿에서 `BisectBatchOnFunctionError` 를 뺐다 | 템플릿 값(true) 유지 — 켜져 있으면 독성 레코드만 DLQ 로 가고 스트림은 계속 흐른다(실측) |
| 스트림 ARN 이 바뀜 | 테이블 재생성 | 스택 ① 재배포 시 Outputs 다시 복사해 스택 ② 재배포 |
| 24시간 넘게 Lambda 가 죽어 있었다 | 스트림 보존 초과 | `aws-opensearch.md § 재색인` |

## 비용

온디맨드 단가는 `미검증`(2024-11 인하 이전 값이 섞여 있을 수 있음 — 비용 실측 후 서울 단가로 대입). 스트림 읽기(Lambda)는 무료.
시험 규모(월 수만 행)면 USD 1 미만.
