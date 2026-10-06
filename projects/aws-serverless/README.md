---
type: project
status: active
goal: "자기 AWS 계정에 S3 → Lambda → DynamoDB → Stream → Lambda → OpenSearch Serverless 파이프라인을 제한된 배포 키로 올리는 레퍼런스 — 계정 준비 안내, IAM 정책 3개, 검증 스크립트, SAM 스택 2개, 스킬 6종"
due:
milestones: []
next_action: "새 이름(Sls*·sls-)으로 실계정 재실측 — validate-policy 0 finding, verify.sh 전부 PASS, stack1·stack2 배포·스모크·철거"
---

# aws-serverless — 서버리스 데이터 파이프라인 레퍼런스

파일을 올리면 자동으로 처리·저장·색인되는 기본 파이프라인을 **자기 AWS 계정**에 만드는 데 필요한 것을 모았다.
서버를 켜 두지 않고 쓴 만큼만 낸다. 개발 절차 안에서 이 프로젝트가 어디에 오는지는 [`../devops/README.md`](../devops/README.md).

```
S3 (원본 업로드)
  └ ObjectCreated → Lambda ingest → DynamoDB (PK=docId, SK=version)
                                      └ Stream → Lambda index → OpenSearch Serverless (검색·집계·시계열)
```

## Status

- 구조(정책 3개 + 스택 2개)는 실계정에서 배포·스모크·음성 확인까지 마친 구성이다. 공개본에서 리소스 이름만
  `Sls*`·`sls-` 로 바꿨고, **이 이름으로는 실계정 재실측 전이다(`미검증`)**. 이름 변경 외 정책 문장은 같다.
- SAM 유닛 테스트: stack1 7건, stack2 13건 통과(`npm test`).
- 실무자 정책 3개(`SlsStaff*`)는 이 이름으로 정책 시뮬레이션 PASS(`config/scripts/staff-policy-sim.sh`, 계정에 아무것도 만들지 않는 문서 평가)와 `validate-policy` 0 finding까지 확인했다. 실계정 적용은 `미검증`.

## 사용 순서

1. **계정 준비** — [`guides/01-aws-account-setup.md`](guides/01-aws-account-setup.md) (스킬 `aws-account-setup`).
   가입·루트 MFA·세금·예산 알림·관리자 IAM 사용자·OpenSearch 용량 상한·S3 퍼블릭 차단.
2. **배포 키 발급** — [`guides/02-restricted-key.md`](guides/02-restricted-key.md) (스킬 `aws-iam-access`).
   정책 3개를 붙인 전용 사용자 `sls-deployer` 의 액세스 키. 사람이든 에이전트든 배포는 이 키로만 한다.
3. **키 검증** — `config/scripts/verify.sh <profile> <account-id>`. 전부 PASS 여야 배포한다. 항목 설명은 [`guides/policy-design.md`](guides/policy-design.md) § verify 체크 표.
4. **배포** — stack1(`aws-s3-ingest`·`aws-lambda-deploy`) → stack2(`aws-dynamodb-stream`·`aws-opensearch`). 스택 이름은 반드시 `sls-` 로 시작한다.
5. (선택) **실무자 권한** — [`guides/03-staff-access.md`](guides/03-staff-access.md). 파이프라인이 선 뒤 데이터를 올리거나(적재) 읽거나(조회) 고치는(수정) 사람에게 유형별 키를 준다. 관리자 권한을 나눠 주지 않는다.
6. (선택) **현행·목표 구조 정리** — [`guides/as-is-to-be.md`](guides/as-is-to-be.md). 데이터 형식·생성 주기·양을 적어 두면 비용 추정의 입력이 된다.

## 구성

| 위치 | 내용 |
|---|---|
| `guides/01-aws-account-setup.md` | 1부 — 계정 가입과 가입 직후 설정 (스크린샷 `guides/screenshots/`) |
| `guides/02-restricted-key.md` | 2부 — 배포 키 발급 |
| `guides/03-staff-access.md` | 3부 — 실무자 권한 (적재·조회·수정) |
| `guides/policy-design.md` | 정책 3개의 설계 근거, verify 체크 표, 정책이 못 막는 비용 |
| `guides/as-is-to-be.md` | 현행(As-Is)·목표(To-Be) 구조 정리 양식 |
| `config/policies/*.json` | 배포 키용 `SlsServerlessAllow` · `SlsGuardDeny` · `SlsLambdaBoundary`, 실무자용 `SlsStaffPush` · `SlsStaffQuery` · `SlsStaffEdit` |
| `config/scripts/verify.sh` | 받은 키가 정책 3개만 붙은 제한 키인지 판정, 실무자 정책이 있으면 원본과 대조(V8b) (AWS CLI v2, python3) |
| `config/scripts/staff-policy-sim.sh` | 실무자 정책의 허용·거부 표를 정책 시뮬레이터로 판정 + 린터. 계정에 아무것도 만들지 않는다 |
| `config/sam/stack1-ingest` | S3 + Lambda ingest + DynamoDB (Node 22 / TypeScript) |
| `config/sam/stack2-index` | DynamoDB Stream + Lambda index + OpenSearch Serverless |
| `config/skills/aws-*.md` | 스킬 6종 — account-setup · iam-access · s3-ingest · lambda-deploy · dynamodb-stream · opensearch |

## 설계 근거

- **도구는 SAM.** CloudFormation 직결, 무료, 콘솔 절차와 나란히 쓰기 쉽다. Serverless Framework v3 는 지원 종료,
  v4 는 일정 매출 이상 조직에 유료 라이선스라 기본 구성으로 쓰지 않았다.
- **스택 경계** — stack1 = 저장·전처리, stack2 = 색인. stack2 는 stack1 의 `TableStreamArn` 을 ImportValue 가 아니라
  **파라미터**로 받는다(콘솔에서 값을 붙여넣을 수 있게).
- **컬렉션 타입은 SEARCH.** TIMESERIES 는 사용자 지정 `_id` 쓰기·업데이트를 지원하지 않아 DynamoDB 의 MODIFY/REMOVE 를 같은 문서에
  반영하지 못한다. 시계열은 SEARCH 컬렉션 + `@timestamp` 필드(원천 `TimestampField` 파라미터, 기본 `eventTime`)로 푼다.
- **멱등** — docId = S3 key, version = S3 versionId. `PutItem` 은 `attribute_not_exists(docId)` 조건부라 같은 (docId, version)
  재실행은 건너뛴다(버저닝을 끈 버킷에 같은 키를 다시 올리면 갱신되지 않는다). OpenSearch `_id` = `docId#version` 이라 재색인도 멱등.
- **색인은 배치당 `_bulk` 1회**, 레코드별 단건 PUT 금지. 호출은 `@opensearch-project/opensearch` + SigV4(`service: 'aoss'`).
- **실패 처리** — ingest 는 비동기 2회 재시도 후 OnFailure → SQS DLQ. index 는 batch 100 · BisectBatchOnFunctionError ·
  재시도 3 · OnFailure → DLQ. DLQ 깊이 > 0 이면 CloudWatch 알람 → SNS 이메일. Stream 은 24시간 지나면 유실되므로
  재색인 절차(DynamoDB Scan → bulk)를 스킬에 둔다.
- **네트워크** — OpenSearch Serverless 네트워크 정책에는 IP 허용목록이 없다 — 정책 문법이 `AllowFromPublic`·`SourceVPCEs`·`SourceServices` 뿐이다(AWS 문서).
  VPC 엔드포인트는 `ec2:*` 가 필요해 기본 정책이 막는다 — 필요하면 정책을 넓힌다.
- **범위 밖** — 업무 API(API Gateway), EventBridge 일정, 대시보드, 서비스별 맞춤 로직. 정책 허용목록에도 API Gateway 는 없다.

| 코드패스 | 실패 | 처리 |
|---|---|---|
| ingest | Lambda 예외·타임아웃 (비동기라 사용자에게 안 보임) | OnFailure DLQ + 알람 → 이메일 |
| index | 독성 레코드가 샤드를 막음 | Bisect + 재시도 3 + DLQ, 24시간 넘으면 재색인 |
| OpenSearch | 컬렉션 생성 대기 / 서비스 연결 역할 | CFN 이벤트에 보인다. 대기 시간은 스킬에 명기 |
| 배포 | 스택 이름 접두어 누락 → 역할 생성 거부 | CFN ROLLBACK. 스택 이름은 `sls-` 로 시작 |

## 검증 메모

옛 리소스 이름으로 같은 구조를 실계정에서 확인한 사실이다. 새 이름으로는 위 `next_action` 이 끝나야 확정된다.

- 정책 린터: `aws accessanalyzer validate-policy` 3개 0 finding. `create-policy-version` 과 정책 시뮬레이터는 존재하지 않는
  액션명을 잡지 못한다(3건 실측) — 정책을 바꾸면 린터부터 돌린다.
- IAM 전파 지연: 정책 적용 88초 뒤 실호출이 통과한 적이 있다 — 실호출 음성 확인은 **적용 3분 뒤**에 한다.
  `verify.sh` 의 시뮬레이션은 저장된 정책을 읽어 전파 지연을 보지 못한다.
- 배포: 제한 키로 stack1·stack2 배포·스모크·철거 성공. 파일 1개 업로드 → 12초 안에 DynamoDB 1행.
- 비용: 서울 OpenSearch Serverless OCU 시간당 USD 0.293. 단가·월 상한 추정은 `config/skills/aws-opensearch.md` § 비용 한곳에 둔다.

## 정책을 바꿀 때

1. `aws accessanalyzer validate-policy --policy-type IDENTITY_POLICY` — 3개 모두 빈 출력(0 finding).
2. `verify.sh` 재실행 — 전부 PASS. 실호출 음성 확인은 적용 3분 뒤.
3. stack1·stack2 를 배포 키로 배포·스모크·철거해 본다.
4. 리소스 이름 접두어(`sls-`)는 정책·SAM 템플릿·`verify.sh` 세 곳이 같이 바뀌어야 한다.

## 개념 (wiki)

각 구성 요소가 무엇이고 왜 쓰는지는 wiki 에 있다. 이 프로젝트의 문서·스킬은 절차만 다룬다.

| 구성 요소 | wiki | 관련 스킬 |
|---|---|---|
| 전체 구조·설계 원칙 | [서버리스 데이터 파이프라인](../../wiki/serverless-data-pipeline.md) | — |
| 원본 보관·이벤트 | [Amazon S3](../../wiki/aws-s3.md) | `aws-s3-ingest` |
| 처리 함수 | [AWS Lambda](../../wiki/aws-lambda.md) | `aws-lambda-deploy` |
| 저장·스트림 | [Amazon DynamoDB](../../wiki/aws-dynamodb.md) | `aws-dynamodb-stream` |
| 검색·집계 | [Amazon OpenSearch Serverless](../../wiki/aws-opensearch-serverless.md) | `aws-opensearch` |
| 권한·키 | [AWS IAM](../../wiki/aws-iam.md) | `aws-account-setup` · `aws-iam-access` |
| 배포 | [AWS SAM](../../wiki/aws-sam.md) | `aws-lambda-deploy` |

## Related

- [`../devops/README.md`](../devops/README.md) — 개발 절차 진입점 (언제 로컬, 언제 이 파이프라인)
