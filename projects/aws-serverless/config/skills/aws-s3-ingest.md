---
name: aws-s3-ingest
description: >
  서버리스 파이프라인 1단계 — 데이터를 S3 버킷에 올리면 자동으로 Lambda가 받아
  DynamoDB에 한 행씩 쌓이게 SAM 스택 ① `stack1-ingest` 를 배포·점검·철거하는 절차. 사용자가 "데이터 올릴 곳
  만들어줘", "S3에 올리면 자동 처리되게", "파이프라인 1단계 배포", "업로드했는데 행이 안 생겨"처럼 요청할 때,
  또는 이 파이프라인의 S3·ingest Lambda·docs 테이블이 화제에 오르면 사용한다. 이 스택의 장애는 여기가 먼저,
  SAM 빌드·롤백 일반은 `aws-lambda-deploy`. 전제: `aws-account-setup`으로 만든 계정과 `aws-iam-access`로 발급한 배포 키.
---

# AWS S3 Ingest (S3 → Lambda → DynamoDB)

> 개념: [Amazon S3](../../../../wiki/aws-s3.md) · [AWS Lambda](../../../../wiki/aws-lambda.md) · [Amazon DynamoDB](../../../../wiki/aws-dynamodb.md) — 이 스킬은 절차만 다룬다.

파일을 S3에 올리는 순간 Lambda가 깨어나 DynamoDB에 "이 파일이 언제·어떤 크기로 들어왔고,
JSON이면 내용이 무엇인지(큰 필드는 S3 원본의 위치로)"를 한 행으로 남긴다. 서버 없이, 올린 만큼만 과금된다.
스택 ② (`aws-dynamodb-stream` → `aws-opensearch`)가 이 행을 받아 검색·집계한다.

## 왜 이렇게 하나 (설명용 한 문단)

지금 데이터는 PC·NAS·엑셀에 흩어져 있고, "어디에 뭐가 있는지"부터가 일이다. S3는 용량 제한 없는
파일 보관소이고, 올리는 행위 자체가 신호가 되어 다음 처리가 자동으로 붙는다. 서버를 사지도,
켜 두지도 않는다. 월 수 GB 규모면 S3·Lambda·DynamoDB 합쳐 커피 한 잔 값 안쪽이다.
대화 로그처럼 레코드 하나가 수백 KB인 데이터도 그대로 받는다. 큰 본문은 S3에 원본 그대로 있고,
검색에는 작은 필드(모델·토큰·비용·상태 같은 것)와 본문의 위치만 들어간다.

## 전제 조건

- AWS CLI v2, SAM CLI 1.150+, Node.js 22 — 로컬 PC.
- 프로파일 하나에 **제한 키**(정책 `SlsServerlessAllow` + `SlsGuardDeny`). Admin 키로 하지 않는다.
- 리전은 `ap-northeast-2`(서울) 고정 — 정책이 다른 리전을 막는다.
- 템플릿 위치: `../sam/stack1-ingest/` (이 스킬과 같이 배포됨).

## 만들어지는 것

```
업로드 ──▶ S3 버킷 (퍼블릭 차단 · SSE-S3 암호화 · 버저닝 · TLS 전용 버킷 정책)
             │ ObjectCreated 이벤트
             ▼
          Lambda ingest (Node 22 · TypeScript · arm64)
             │ PutItem   실패 2회 재시도 → DLQ(SQS) → CloudWatch 알람 → SNS
             ▼
          DynamoDB docs 테이블  PK docId(= S3 키) · SK version(= S3 versionId)
             │ Stream (NEW_AND_OLD_IMAGES)  ← 스택 ② 입력
```

행 내용: `docId · version · bucket · size · etag · eventTime · eventName · ingestedAt`,
그리고 4 MiB 이하 `application/json`(`+json`) 객체는 본문을 `data` 로 넣는다. 규칙(`src/transform.ts` `offloadLargeFields`):

- **256 KiB(262,144바이트) 이하 JSON 은 통째로** — 이전과 같다.
- **256 KiB 를 넘는 값은 `data` 에서 빼고, 같은 객체에 `<필드>$ref` 를 둔다.** 크기 = `JSON.stringify(값)` 의 UTF-8 바이트.
  ref = `{ key, versionId, pointer, bytes }` — 원본 객체 버전과 그 안의 위치(JSON Pointer, RFC 6901), 원래 바이트 수.
  값은 원본에 이미 있으니 따로 복사하지 않는다(추가 PUT 0). 꺼내 보기: `aws s3api get-object --bucket $B --key <key> --version-id <versionId> /tmp/o.json` 후 `pointer` 위치를 읽는다.
- 객체는 안으로 내려가 작은 필드를 남기고, 그래도 크면 객체째 뺀다. 배열·문자열은 통째로 뺀다(배열 안에는 ref 를 두지 않는다).
- **가드**: 그래도 `data` 의 DynamoDB 크기가 256 KiB 를 넘으면 배열·값 → 객체 → 문서 전체 순으로 큰 것부터 같은 방식으로 뺀다(1 KiB 이상 줄어드는 것만). 그래서 행은 언제나 `data` 256 KiB + 메타데이터 수백 바이트 이하 — DynamoDB 한도 400 KB 안이다.
- **깊이**: DynamoDB 맵·리스트는 32단계까지만 중첩된다(AWS "Constraints" › Nested attribute depth). 넘으면 Put 이 `ValidationException`("Nesting Levels have exceeded supported limits")으로 실패해 재시도 2회 뒤 DLQ 로 간다.
  세는 법은 AWS 문서에 없어 가장 엄격하게 센다 — `data` 자신이 1단계, 맨 끝 값(문자열·숫자)도 1단계(`MAX_NESTING_DEPTH`). 넘는 값은 같은 방식으로 `<필드>$ref` 로 뺀다.
  ref 자체가 2단계(맵 + 값)라 바닥 바로 위 객체는 안으로 내려가지 않고 객체째, 배열은 늘 통째로 뺀다. 크기 규칙보다 먼저 돌고, 크기 규칙이 바닥 근처에 둔 ref 때문에 한 번 더 돈다.
  단, 객체 약 1,600단계·배열 약 6,500단계보다 깊으면 함수가 스택 한도로 실패한다(`RangeError` → DLQ, 로컬 실측 10-02, `미대응`).
- **JSON 루트가 배열이면 레코드마다 자식 행**을 만든다(`childRows`). 파일 행(부모)은 원본 S3 정보와 `count`(레코드 수)만 갖고 `data` 는 없다.
  자식 행은 `docId` 가 `<파일 경로>#<순번>`, `version` 은 부모와 같고, `parent`(부모 키)·`index`(순번)·`size`(레코드 JSON 바이트)·`data`(위 규칙 그대로, `pointer` 는 `/<순번>/…`)를 갖는다.
  자식마다 파티션 키가 달라 쓰기가 한 파티션에 몰리지 않는다 — 부모와 같은 `docId` 로 두었을 때 120 KB × 34건이 재시도까지 모두 스로틀됐다(10-06 실측). 한 파일의 레코드는 OpenSearch 에서 `parent.docId` 로 찾는다.
  자식 행을 먼저 쓰고 파일 행을 마지막에 쓴다 — 파일 행이 있으면 자식 행은 다 들어가 있다. 배열이 1,000건(`MAX_CHILD_ROWS`)을 넘으면 펼치지 않고 아래처럼 한 행 — 256 MB 함수 실측 초당 약 134행, 재시도도 전체를 다시 보내므로 한 번에 30초 안에 끝나야 한다(10-06, 5,000건은 3,825행에서 시간 초과).
  레코드만 집계하려면 `parent` 가 있는 문서로 거른다(부모 행에는 `parent` 가 없다).
- 그 밖에 문서가 객체가 아니면 `{ value }` 로 감싸고, 뺄 때 `value$ref` 의 `pointer` 는 `""`(문서 전체).
- **4 MiB 를 넘는 JSON 은 메타데이터만** — 256 MB Lambda 가 파싱할 수 있는 상한(로컬 실측 근거는 `MAX_PARSE_JSON_BYTES` 주석).

**파일 하나 = 행 하나다**(JSON 배열 파일만 위처럼 부모 + 레코드별 자식 행). CSV·엑셀의 줄을 행으로 펼치지 않는다(`src/transform.ts` `shouldInlineJson` — `text/csv` 는 인라인도 안 한다).
CSV 도 파일당 행 하나는 생긴다 — **행이 0 이면 연결 고장**(아래 진단 순서), 행은 있는데 "줄이 행으로 안 생겼다" 면 설계대로다. 줄 단위 적재는 데이터 형식별 가공 코드(`mts`)로 만든다(As-Is/To-Be 양식 B2 의 "파서" 칸) — `raw/<형식>/<날짜>/<파일>` 로 올리면 `src/transformers/<형식>.mts` 가 레코드마다 행을 만든다(Content-Type 무관, 32 MiB·50,000건 이하 — 넘으면 실패 → DLQ → 알람). 만드는 법은 `aws-transformer`.

| 이름 (스택명 = `<S>`) | 값 |
|---|---|
| 버킷 | `<S>-data-<계정ID>` |
| 테이블 | `<S>-docs` |
| DLQ / 알람 | `<S>-ingest-dlq` / `<S>-ingest-dlq-not-empty` |
| 로그 그룹 | `/aws/lambda/<IngestFunctionName>` — 보존 14일 |
| Outputs | `BucketName` · `TableName` · `TableStreamArn` · `IngestFunctionName` · `DlqUrl` |

## 절차

`aws` 명령 전에 `export AWS_PROFILE=sls-deployer AWS_REGION=ap-northeast-2` — 기본(default) 프로파일은 다른 계정일 수 있다(`aws-lambda-deploy.md § 절차`).

0. **질의 방식 묻기 (배포 전, 요구 정리).** 넷 중 하나를 정하고 답과 이유를 프로젝트 README 에 적는다 — 답이 스택 ① 파라미터 `SidecarEnabled` 를 정한다.

   | 답 | 스택 | `SidecarEnabled` |
   |---|---|---|
   | 검색 엔진(OpenSearch)만 | ① + ② | `false`(기본) |
   | Athena 만 | ① + ③ | `true` |
   | 둘 다 | ① + ② + ③ | `true` |
   | 둘 다 안 씀(키 조회만) | ① | `false` |

   `true` 면 transformer가 읽은 파일마다 `sidecar/<형식>/<날짜>/<파일>.jsonl`(NDJSON, 한 줄 = 레코드 1개)을 하나 더 쓴다. **질의를 하지 않아도 드는 상시 비용**이라 물을 때 같이 알린다(서울, 무료 사용량 제외 — AWS Price List 2026-09-28): PUT 파일당 1건 × USD 0.0045/1,000, 저장 누적 GB × USD 0.025/월(지우지 않으면 쌓인다), sidecar 쓰기가 다시 깨우는 Lambda 호출 파일당 1회(USD 0.20/100만 건 + 짧은 실행 — sidecar 경로는 행 없이 바로 끝난다). 월 1만 파일·누적 1 GB면 월 USD 0.1 안쪽, 월 100만 파일이면 PUT 만 USD 4.5.
   나중에 켜면 **켠 시점부터** 생긴다 — 이전 데이터는 소급 처리 스크립트가 없다(필요해지면 만든다). sidecar 키는 원본 경로를 따르므로 날짜 칸은 `YYYY-MM-DD` 로 올린다(Athena 파티션). 원본 위치는 `raw$ref` 와 함께 `$` 없는 `rawKey`·`rawVersionId`·`rawPointer` 로도 쓴다(Athena가 `$` 든 키를 못 읽는다). Athena 쪽 절차는 `aws-athena`.
1. **이름 정하기.** 스택명은 반드시 `sls-` 로 시작한다 (예: `sls-<project>-ingest`).
   SAM이 만드는 Lambda 실행 role 이름이 스택명으로 시작하고, 제한 키는 `role/sls-*` 만 만들 수 있다.
   접두가 빠지면 CloudFormation이 role 생성에서 실패하고 롤백된다.
2. **설정.** `aws-lambda-deploy.md § 프로젝트별 설정 파일` 대로 `../sam/stack1-ingest/samconfig.<project>.toml` 을 만들고
   `stack_name` 과 `AlarmEmail`(**필수** — 비우면 파라미터 검증에서 실패, 배포 후 구독 확인 메일을 눌러야 알람이 온다)을 채운다.
   0번 답이 Athena·둘 다면 `parameter_overrides` 에 ` SidecarEnabled=\"true\"` 를 더한다(함수 role에 `sidecar/*` PutObject 문 하나가 같이 생긴다).
3. **빌드·배포.**
   ```bash
   cd ../sam/stack1-ingest
   npm ci
   npx vitest run                                   # 실패 0
   PATH="$PWD/node_modules/.bin:$PATH" sam build    # esbuild 를 PATH 에 — 없으면 "Cannot find esbuild"
   sam deploy --config-file samconfig.<project>.toml --profile sls-deployer   # 첫 배포 3~5분
   ```
   `Outputs` 다섯 개(위 표)를 프로젝트 노트에 기록한다. `TableStreamArn` 은 스택 ② 파라미터다.
4. **스모크.**
   ```bash
   B=<BucketName>; T=<TableName>
   echo '{"line":"A1","temp":72.5}' > /tmp/s.json
   aws s3 cp /tmp/s.json "s3://$B/sample.json" --content-type application/json
   sleep 10
   aws dynamodb scan --table-name $T --query 'Items[].[docId.S, size.N, data.M.line.S]' --output text
   ```
   `sample.json 24 A1` 한 줄이 나오면 통과. 같은 파일을 다시 올리면 버전이 달라 **행이 하나 더** 생긴다(버저닝).
5. **콘솔로 확인하기.** S3 → 버킷 → 객체 목록 / DynamoDB → 테이블 → "테이블 항목 탐색" /
   Lambda → 함수 → 모니터링 → 로그. 세 화면이면 흐름이 한눈에 보인다.

## 검증 체크

| 확인 | 명령 | 기대 |
|---|---|---|
| 퍼블릭 차단 | `aws s3api get-public-access-block --bucket $B` | 네 값 전부 `true` |
| 암호화 | `aws s3api get-bucket-encryption --bucket $B` | `AES256` |
| 실패 경로 | `aws-lambda-deploy.md § 직접 호출해 보기` 의 샘플 이벤트를 `BUCKET` 치환 없이 `--invocation-type Event` 로 | 재시도 2회(약 3분) 뒤 DLQ 메시지 1, 알람 `ALARM` (`미검증` — 09-23 실측 기록 없음) |
| 로그 | `aws logs tail /aws/lambda/$F --since 1h \| grep -c '"msg":"ingested"'` | 업로드 건수만큼 (로그는 텍스트 형식이라 JSON 필터 패턴은 안 먹는다. `already-ingested` 는 재시도 건) |

## 업로드했는데 행이 안 생긴다 — 진단 순서

앞 단계가 멀쩡해야 뒤를 볼 의미가 있다. 위에서부터:

```bash
export AWS_PROFILE=sls-deployer AWS_REGION=ap-northeast-2
S=sls-<project>-ingest
aws sts get-caller-identity --query Account --output text                              # 0. 배포 대상 계정인가(다른 계정이면 프로파일 틀림)
out() { aws cloudformation describe-stacks --stack-name $S --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
B=$(out BucketName); T=$(out TableName); F=$(out IngestFunctionName); Q=$(out DlqUrl)
aws dynamodb scan --table-name $T --select COUNT                                        # 1. 정말 0행인가
aws s3api list-object-versions --bucket $B --max-items 20 --query 'Versions[].[Key,LastModified]' --output text   # 2. 파일이 이 버킷에 있나
aws s3api get-bucket-notification-configuration --bucket $B                             # 3. 이벤트 연결 (LambdaFunctionConfigurations 1개)
aws logs tail /aws/lambda/$F --since 1d | grep -E '"msg"|ERROR|Task timed out'          # 4. 함수가 불렸나·실패했나
aws sqs get-queue-attributes --queue-url $Q --attribute-names ApproximateNumberOfMessages   # 5. 실패가 DLQ 로 갔나
```

| 본 것 | 뜻 | 조치 |
|---|---|---|
| 행은 있는데 찾는 사람은 "없다" | 파일 하나 = 행 하나. CSV 줄을 찾고 있다 | 설계 설명(위 "파일 하나 = 행 하나"), 줄 적재가 필요하면 파서 추가 |
| JSON 인데 행에 `data` 가 없다 | 4 MiB 초과(파싱 상한), `Content-Type` 이 JSON 이 아님, 또는 JSON 문법 오류 | `aws s3api head-object` 로 `ContentLength`·`ContentType` 확인. 타입이 틀렸으면 `--content-type application/json` 으로 다시 올린다 |
| `data` 에 찾는 필드가 없고 `<필드>$ref` 가 있다 | 256 KiB 넘는 값이거나 32단계보다 깊은 값이라 S3 원본에 두었다(설계) | ref 의 `key`·`versionId`·`pointer` 로 원본에서 꺼낸다(위 "행 내용") |
| 2 에 파일 없음 | 다른 버킷·다른 계정·다른 리전에 올렸다 | 버킷 이름·콘솔 우측 상단 계정/리전 확인 |
| 파일의 `LastModified` 가 스택 생성보다 이르다 | 스택 전에 올린 파일은 이벤트가 없다 | 같은 키로 다시 올린다(`aws s3 cp` — 새 버전이 이벤트를 만든다) |
| 3 이 비었다 | 알림 설정이 지워졌다(콘솔 수동 변경 등) | 스택 재배포 |
| 4 에 호출 흔적 없음, 3 정상 | 이벤트가 안 옴 — 호출 권한 | `aws lambda get-policy --function-name $F` 에 `s3.amazonaws.com` 허용이 있는지, 없으면 재배포 |
| 4 에 `ERROR`·`Task timed out` | 함수 실패 → 재시도 2회 → DLQ | 오류 문구로 원인 수정 후 재배포, DLQ 재처리는 아래 "자주 막히는 곳" 의 "재시도 중 코드를 고쳐…" 항목 |
| 4 에 `over MAX_TRANSFORM_BYTES`·`over MAX_TRANSFORMED_ROWS` `— split the file` | `raw/<형식>/` 파일이 한도(32 MiB·50,000건, `aws-transformer` § 한도)를 넘었다 — 레코드는 하나도 쓰이지 않았다 | **재처리하지 않는다**(같은 파일은 다시 실패한다). 파일을 나눠 새 키로 다시 올리고, 그 DLQ 메시지는 `aws sqs delete-message` 로 지운다 |
| 로그가 비었는데 14일이 지났다 | 로그 보존 14일 | 다시 올려 재현 |

## 자주 막히는 곳 (실측)

- **`Dynamic require of "node:https" is not supported`** 로 Lambda가 init에서 죽는다 — esbuild `Format: esm` 에
  AWS SDK를 번들했을 때. 템플릿은 `Format: cjs` 다. 바꾸지 않는다.
- **`Cannot find esbuild`** — `sam build` 가 프로젝트 `node_modules` 를 안 본다. 위 `PATH=` 접두로 실행.
- **role 생성 AccessDenied** — 스택명 접두 누락. 스택을 지우고 이름 바꿔 다시.
- **HTTP(`http://`)로 부르면 403 / "explicit deny in a resource-based policy"** — 버킷 정책이 TLS 요청만 받는다(09-29 실측). CLI·SDK 기본은 HTTPS 라 `--endpoint-url http://…` 같은 설정만 걸린다.
- 버킷 이름은 `<스택명>-data-<계정ID>` 로 고정된다(순환 참조 회피). 바꾸려면 템플릿의 두 곳을 같이 바꾼다.
- 재시도 중 코드를 고쳐 재배포하면, 남은 재시도는 **새 코드로** 돈다 — 실패했던 이벤트가 살아난다.
  DLQ 에 이미 들어간 건은 수동으로 다시 넣는다. 메시지 본문은 Lambda 비동기 실패 기록이라 원본 S3 이벤트가 `requestPayload` 안에 있다(AWS 문서 기준, 실측 `미검증`):
  ```bash
  aws sqs receive-message --queue-url $Q --max-number-of-messages 10 --visibility-timeout 300 --query 'Messages[].Body' --output text \
    | head -1 | python3 -c 'import sys,json;print(json.dumps(json.loads(sys.stdin.read())["requestPayload"]))' > /tmp/replay.json
  aws lambda invoke --function-name $F --cli-read-timeout 310 --cli-binary-format raw-in-base64-out --payload file:///tmp/replay.json /tmp/out.json && cat /tmp/out.json
  ```
  `--cli-read-timeout 310`: 함수 제한 시간이 300초이고 큰 transformer 파일은 정상 처리에도 1분을 넘길 수 있다(5만 건 실측 51초, 가장 느린 처리량 초당 655행이면 약 76초) — CLI 기본 60초에 끊기면 성공한 호출도 오류로 보이고, CLI 가 같은 호출을 다시 보낼 수 있다(추정).
  오류가 `over MAX_TRANSFORM_BYTES`·`over MAX_TRANSFORMED_ROWS` 면 재처리하지 않는다 — 위 진단 표.
  조건부 Put 이라 이미 적재된 버전은 `skipped` 로 끝난다(중복 걱정 없음). 처리한 메시지는 그 `ReceiptHandle` 로 `aws sqs delete-message`.

## 비용

- 단가를 여기 적지 않는다 — 실제 비용은 Budgets 알림과 Cost Explorer(`../scripts/verify.sh` V3d 가 읽는 것)로 본다. 시험 규모(09-24 20분·09-27 72분)에서 S3·Lambda·DynamoDB 합계 USD 0.001 미만이었다(실측).
- 비용이 보이는 건 버저닝(같은 파일 반복 업로드 시 버전 누적)뿐 — 수명주기 규칙으로 30일 뒤 이전 버전 삭제를 걸 수 있다.
  **이전 버전을 지우면 그 버전을 가리키던 `$ref` 는 꺼낼 곳이 없어진다** — 행(`version`)도 같은 버전을 가리키므로 행과 같이 정리한다.
- 256 KiB~4 MiB JSON 은 객체당 GET 1회와 파싱 시간이 붙고, 행이 메타데이터(1 KB 안쪽)에서 최대 256 KiB 로 커진다 — DynamoDB 쓰기 용량은 1 KB 단위라 그런 행 하나가 최대 257 WRU 다.

## 철거

**스택 ② 를 먼저 지운다** — ② 가 이 테이블의 스트림을 쓴다(`aws-opensearch.md § 철거`). 사용 종료 전체 순서는 `aws-iam-access.md § 사용 종료·정리`.

```bash
export AWS_PROFILE=sls-deployer AWS_REGION=ap-northeast-2
# 버저닝 버킷은 sam delete 가 못 지운다 — 버전·삭제 마커를 먼저 비운다
aws s3api list-object-versions --bucket $B --output json \
  | python3 -c 'import sys,json;v=json.load(sys.stdin);print(json.dumps({"Objects":[{"Key":x["Key"],"VersionId":x["VersionId"]} for k in ("Versions","DeleteMarkers") for x in v.get(k,[])],"Quiet":True}))' \
  > /tmp/del.json && aws s3api delete-objects --bucket $B --delete file:///tmp/del.json
sam delete --config-file samconfig.<project>.toml --profile sls-deployer --no-prompts     # ../sam/stack1-ingest 에서
```
