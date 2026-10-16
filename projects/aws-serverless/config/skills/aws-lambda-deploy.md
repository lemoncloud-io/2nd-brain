---
name: aws-lambda-deploy
description: >
  서버리스 파이프라인 Lambda(Node.js 22 · TypeScript)를 SAM으로 빌드·배포·수정·롤백하는 공통 절차.
  사용자가 "Lambda 코드 고쳐서 다시 올려줘", "함수 로그 봐줘", "sam build 가 안 돼", "롤백해줘"처럼 요청할 때,
  또는 `aws-s3-ingest`·`aws-dynamodb-stream`·`aws-opensearch` 스킬이 배포 단계에서 이 스킬을 가리킬 때 사용한다.
  스택 고유의 장애(S3 이벤트·스트림·DLQ·컬렉션·매핑)는 그 스택 스킬의 실패 모드가 먼저이고, 여기는 SAM·esbuild·
  role·롤백처럼 스택에 공통인 것만 다룬다. Python 런타임·컨테이너 이미지·Serverless Framework는 다루지 않는다.
---

# AWS Lambda Deploy (SAM · Node.js 22 · TypeScript)

> 개념: [AWS Lambda](../../../../wiki/aws-lambda.md) · [AWS SAM](../../../../wiki/aws-sam.md) — 이 스킬은 절차만 다룬다.

Lambda는 "이벤트가 오면 함수 하나가 잠깐 돌고 꺼지는" 실행 방식이다. 서버·OS·패치·스케일 관리가 없다.
이 프로젝트의 모든 Lambda는 **SAM 템플릿 + esbuild 번들 TypeScript** 한 가지 방식으로만 만든다 —
콘솔에서 코드를 직접 고치지 않는다(다음 배포가 덮어쓴다).

## 왜 Lambda인가 (설명용 한 문단)

데이터가 들어오는 순간에만 잠깐 계산이 필요하다. EC2 같은 서버는 24시간 켜 두고 요금을 내지만,
Lambda는 실행 시간 1 ms 단위로만 낸다. 월 100만 건 호출·40만 GB-초까지 무료다(`미검증` — 요금표 확인 후 확정). 코드는 이 패키지에 든
TypeScript 파일 한두 개이고, 고치면 명령 하나로 다시 올라간다.

## 프로젝트 모양

```
sam/<스택>/
  template.yaml      리소스 정의 (SAM)
  samconfig.toml     자리표시자만 있는 틀 (커밋됨 — 값을 채우지 않는다)
  samconfig.<project>.toml  프로젝트별 사본 (git 무시 — 스택명·메일·ARN 은 여기에만)
  package.json       devDependencies: esbuild · typescript · vitest · @types/aws-lambda
  src/<handler>.ts   진입점 — export const handler
  src/transform.ts   순수 함수 (테스트 대상)
  test/*.test.ts     vitest
  test/*.json        직접 호출용 샘플 이벤트 (스택 ①: s3-put-event.json)
  .aws-sam/          빌드 산출물 (커밋하지 않는다)
```

템플릿의 함수 정의에서 바꾸지 않는 것:

```yaml
Globals:
  Function:
    Runtime: nodejs22.x
    Architectures: [arm64]         # 단가 x86 보다 낮음(AWS 공표 약 20%, `미검증`). 실측 스택은 arm64 로 통과
    PermissionsBoundary: !Sub "arn:aws:iam::${AWS::AccountId}:policy/SlsLambdaBoundary"  # 없으면 제한 키가 role 을 못 만든다
Resources:
  XxxFunction:
    Type: AWS::Serverless::Function
    Metadata:
      BuildMethod: esbuild
      BuildProperties:
        Format: cjs                # esm 이면 init 에서 죽는다 (아래)
        Target: es2022
        Minify: true
        EntryPoints: [src/xxx.ts]
    Properties:
      Handler: xxx.handler
```

## 절차

모든 명령은 **이 스킬 파일 기준 상대 경로**(`../sam/<스택>`)로 쓴다. 볼트 루트에서는 `projects/aws-serverless/config/sam/<스택>`.
`aws` 명령을 치기 전에 셸에서 한 번 — 기본(default) 프로파일이 **다른 계정**(또는 관리자 키)일 수 있어 빼먹으면 엉뚱한 계정을 친다:

```bash
export AWS_PROFILE=sls-deployer AWS_REGION=ap-northeast-2
```
`sls-deployer` = 배포 키를 등록한 프로파일 이름(`aws-iam-access` 절차 B). `<project>` = 프로젝트 영문 약칭 하나(예 `acme`) — 프로젝트별 설정 파일 이름, 스택명(`sls-<project>-ingest`)에 같은 값을 쓴다.
아래 블록의 `cd ../sam/<스택>` 은 이 스킬 파일 위치 기준이다 — 블록을 이어 붙여 칠 때는 볼트 루트 기준 `projects/aws-serverless/config/sam/<스택>` 으로.

### 프로젝트별 설정 파일 (프로젝트당 한 번)

```bash
cd ../sam/<스택>
cp samconfig.toml samconfig.<project>.toml     # git 무시됨 — 프로젝트 값은 이 파일에만
```
`samconfig.<project>.toml` 의 `stack_name`(`sls-<project>-ingest` / `-index`)과 `parameter_overrides` 자리표시자를 채운다.
스택명이 이 파일에 남아 재배포·철거가 같은 스택을 친다 — 스택명을 바꾸면 **새 스택**이 생긴다.
이 파일은 이 PC 에만 있다(git 무시) — 스택명·`AlarmEmail` 을 프로젝트 노트에 한 줄 적어 두면 다른 PC 에서도 같은 값으로 다시 만든다.
파일을 잃었으면 스택명을 계정에서 찾는다:
`aws cloudformation describe-stacks --query "Stacks[?starts_with(StackName,'sls-')].[StackName,StackStatus]" --output text`

### 배포 (처음이든 수정이든 같다)

```bash
cd ../sam/<스택>
npm ci
npx tsc --noEmit                                  # 타입
npx vitest run                                    # 유닛
PATH="$PWD/node_modules/.bin:$PATH" sam build     # esbuild → .aws-sam/build
sam deploy --config-file samconfig.<project>.toml --profile sls-deployer
```

- `sam deploy` 는 변경 세트를 만들어 바뀐 리소스만 갱신한다. 코드만 바꿨으면 Lambda 하나만 갱신된다. 바뀐 게 없으면 `No changes to deploy` 로 **성공 종료**한다(`fail_on_empty_changeset = false`) — 코드를 고쳤는데 이 문구면 빌드가 안 된 것.
- 배포할 코드가 지금 작업 트리의 코드다 — `git status`·`git log -1` 로 고친 내용이 들어 있는지 먼저 본다.
- 스택명은 **`sls-` 접두** — 제한 키가 만들 수 있는 role 경로가 `role/sls-*` 다. 템플릿에 `RoleName` 을 직접 쓰지 않는다(재배포 충돌).
- 권한은 템플릿 `Policies:` 에 최소로 — SAM 정책 템플릿(`DynamoDBWritePolicy` 등) 또는 인라인 `Statement`.
  role 에는 `SlsLambdaBoundary` 가 붙어야 하고(위 Globals), 그 밖의 관리형 정책 부착·바운더리 없는 role 생성은 제한 키 정책이 거부한다. 인라인에 무엇을 적어도 실효 권한은 바운더리 안.
- `AlarmEmail` 은 필수 파라미터 — 배포 직후 SNS 구독 확인 메일의 링크를 눌러야 알람이 온다. 값을 바꿔 재배포하면 구독이 새로 생겨 확인 메일을 다시 눌러야 한다.

### 로그 보기

```bash
F=<함수명>   # 스택 Outputs 의 IngestFunctionName / IndexFunctionName
# aws cloudformation describe-stacks --stack-name <스택명> --query 'Stacks[0].Outputs' --output table
aws logs tail /aws/lambda/$F --since 30m                       # 최근 30분
aws logs filter-log-events --log-group-name /aws/lambda/$F --filter-pattern 'ERROR' --query 'events[].message' --output text
```
`REPORT` 줄의 `Duration`·`Max Memory Used` 로 메모리 크기를 정한다 — 사용량의 두 배 정도면 충분.

### 직접 호출해 보기

```bash
cd ../sam/stack1-ingest
sed "s/BUCKET/$B/g" test/s3-put-event.json > /tmp/event.json        # B = Outputs BucketName, sample.json 이 올라가 있어야 한다
aws lambda invoke --function-name $F --cli-binary-format raw-in-base64-out \
  --payload file:///tmp/event.json /tmp/out.json && cat /tmp/out.json      # {"written":1,...} 또는 이미 있으면 skipped
```
비동기 경로(S3 이벤트)를 흉내 내려면 `--invocation-type Event` — 실패 시 재시도·DLQ 동작을 그대로 탄다.
`BUCKET` 을 치환하지 않고 보내면 없는 버킷이라 실패 경로(재시도 2회 → DLQ)를 탄다.

### 롤백

```bash
S=<스택명>
aws cloudformation describe-stacks --stack-name $S --query 'Stacks[0].StackStatus' --output text
aws cloudformation describe-stack-events --stack-name $S --max-items 100 \
  --query "StackEvents[?contains(ResourceStatus,'FAILED')].[LogicalResourceId,ResourceStatusReason]" --output text   # 원인
```
CloudFormation 은 배포 실패 시 자동으로 직전 상태로 되돌린다. 그 다음 할 일은 스택 상태로 갈린다:

| 상태 | 뜻 | 다음 |
|---|---|---|
| `UPDATE_ROLLBACK_COMPLETE` | 갱신 실패, 직전 상태(옛 코드)로 복구됨 — 서비스는 계속 돈다 | 위 이벤트로 원인을 보고 고친 뒤 같은 `sam deploy` |
| `ROLLBACK_COMPLETE` | **첫 생성** 실패 — 스택은 있지만 리소스 없음, 갱신 불가 | `sam delete --config-file samconfig.<project>.toml --profile sls-deployer --no-prompts` 후 다시 배포 |
| `UPDATE_ROLLBACK_FAILED` | 복구 도중 막힘(수동 삭제된 리소스 등) | `aws cloudformation continue-update-rollback --stack-name $S` → 그래도 안 되면 `--resources-to-skip <논리ID>` |
| `DELETE_FAILED` | 삭제 도중 막힘(버저닝 버킷이 대부분) | `aws-s3-ingest.md § 철거` 대로 버킷 비운 뒤 재삭제 |

코드를 이전 버전으로 되돌리는 것도 재배포다:

```bash
git checkout <이전 커밋> -- src/
PATH="$PWD/node_modules/.bin:$PATH" sam build && sam deploy --config-file samconfig.<project>.toml --profile sls-deployer
git checkout HEAD -- src/        # 작업 트리 원복 (되돌린 코드를 유지하려면 커밋)
```

### 철거

`sam delete --config-file samconfig.<project>.toml --profile sls-deployer --no-prompts`. 로그 그룹은 템플릿에 명시돼 있어 같이 지워진다. 버저닝 S3 버킷이 있는 스택은 `aws-s3-ingest.md § 철거` 순서, 사용 종료 전체 순서는 `aws-iam-access.md § 사용 종료·정리`.

## 실패 모드와 대응

| 증상 | 원인 | 대응 |
|---|---|---|
| `Dynamic require of "node:https" is not supported` (init 실패, 매 호출) | esbuild `Format: esm` + AWS SDK 번들 | `Format: cjs` |
| `Cannot find esbuild` | `sam build` 가 프로젝트 node_modules 를 안 봄 | `PATH="$PWD/node_modules/.bin:$PATH" sam build` |
| role 생성 `AccessDenied` → ROLLBACK | 스택명 접두 누락, 또는 `PermissionsBoundary` 누락/계정에 `SlsLambdaBoundary` 없음 | 스택 삭제 후 `sls-` 로 재생성 / Globals 에 바운더리 / 계정 관리자가 `../../guides/02-restricted-key.md` § 2.1 로 정책 생성 |
| `iam:PassRole` 거부 | 함수에 `sls-*` 아닌 role 지정 | 템플릿에서 `Role:` 제거, SAM 자동 role 사용 |
| `Lambda was unable to encrypt your environment variables … kms:Encrypt … explicit deny` | 제한 키 GuardDeny 에 KMS 데이터 액션 예외 없음(v3 이전 NotAction 초안) | 정책 최신본(`../policies/`)으로 갱신 |
| 비동기 호출 2회 재시도 후 사라짐 | `EventInvokeConfig` 없음 | 템플릿에 `OnFailure: SQS` (`../sam/stack1-ingest/template.yaml` 참고) |
| 스트림 배치 반복 실패, 뒤 레코드 정체 | 독성 레코드 | `BisectBatchOnFunctionError: true` + `MaximumRetryAttempts` + DLQ (`../sam/stack2-index/template.yaml` 참고) |
| 배포는 됐는데 새 스택이 하나 더 생김 | `stack_name` 이 첫 배포와 다름 | 프로젝트별 `samconfig.<project>.toml` 로만 배포. 잘못 만든 스택은 `sam delete --stack-name <그 이름>` |
| 코드 고쳤는데 그대로 | `sam build` 안 하고 `deploy` 만 | build → deploy 순서. `.aws-sam/` 삭제 후 재빌드 |
| 타임아웃 | 기본 3초 | `Globals.Function.Timeout` — 파이프라인은 30~60초 |

## 테스트 규칙

- 이벤트 → 항목 변환 같은 순수 함수는 `src/transform.ts` 로 분리해 vitest 유닛 — 한글 키·빈 값·경계값 포함.
- AWS 호출이 있는 handler 는 배포 후 스모크로 — 로컬 에뮬레이션(`sam local`)은 이 프로젝트에서 쓰지 않는다(Docker 필요, 실측과 차이).
- 배포 전 `npx tsc --noEmit` 0 에러.
