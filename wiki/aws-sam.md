---
type: tool
topics:
  - aws-serverless
status: draft
sources:
  - "https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/what-is-sam.html"
  - "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/transform-aws-serverless.html"
  - "https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-function.html"
  - "https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-build.html"
  - "https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-using-build-typescript.html"
  - "https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-deploy.html"
  - "https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-delete.html"
  - "https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-config.html"
  - "https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html"
  - "https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/view-stack-events.html"
  - "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/intrinsic-function-reference-importvalue.html"
  - "[[projects/aws-serverless/README|aws-serverless]]"
created: "2026-10-06"
updated: "2026-10-06"
---

# AWS SAM

## Summary

AWS SAM(Serverless Application Model)은 서버리스 애플리케이션을 코드로 정의하는 오픈소스 IaC 프레임워크다. 두 부분으로 이뤄진다.

- **SAM 템플릿** — CloudFormation 템플릿의 확장이다. 템플릿 맨 위에 `Transform: AWS::Serverless-2016-10-31`(이 문자열 그대로)을 선언하면
  `AWS::Serverless::Function` 같은 축약 리소스를 쓸 수 있다. 변경 세트를 만들 때 CloudFormation이 이를 일반 리소스로 펼친다.
  함수 하나는 `AWS::Lambda::Function`, 실행 역할(`Role:`을 안 주면 `<논리 ID>Role`), 트리거용 이벤트 소스 매핑으로 바뀐다.
- **SAM CLI** — 빌드·배포·삭제 등을 하는 명령줄 도구다.

SAM이 따로 상태를 들고 있지는 않다. 배포 결과는 CloudFormation **스택**이고, 갱신·롤백·삭제는 모두 CloudFormation이 한다.

| 용어 | 뜻 |
|---|---|
| 템플릿 | 리소스 선언 파일(`template.yaml`) |
| 스택 | 템플릿 하나로 만든 리소스 묶음. 같은 스택 이름으로 배포하면 갱신, 새 이름이면 새 스택 |
| 변경 세트(change set) | 스택에서 무엇이 추가·수정·삭제될지 미리 계산한 결과. 실행(execute)해야 스택이 바뀐다 |
| 롤백 | 배포 중 오류가 나면 기본으로 스택을 마지막 안정 상태로 되돌린다 |

롤백 뒤 스택 상태가 다음 할 일을 정한다.

- `ROLLBACK_COMPLETE` — **첫 생성**이 실패해 만들던 리소스를 지운 상태. 삭제만 할 수 있다 → `sam delete` 후 다시 배포.
- `UPDATE_ROLLBACK_COMPLETE` — 갱신이 실패해 직전 상태로 돌아간 상태. 원인을 고쳐 다시 배포한다.
- `UPDATE_ROLLBACK_FAILED` — 되돌리는 도중 실패. 롤백을 이어서 진행(continue rollback)하거나 스택을 삭제한다.
- `DELETE_FAILED` — 삭제 실패. 리소스 일부가 남아 있을 수 있고 스택은 갱신할 수 없다. 이 파이프라인에서는 버저닝 버킷이 대부분이다.

| 명령 | 하는 일 |
|---|---|
| `sam build` | 배포할 수 있게 앱을 준비한다. 함수에 `Metadata: BuildMethod: esbuild`가 있으면 esbuild로 번들한다(TypeScript 가능). `--cached`는 바뀌지 않은 산출물 재사용, `--parallel`은 함수 병렬 빌드 |
| `sam deploy` | 변경 세트를 계산해 CloudFormation으로 배포한다. 스택이 있으면 갱신, 없으면 생성 |
| `sam delete` | CloudFormation 스택, S3·ECR에 올린 배포 산출물, 템플릿 파일을 지운다. `--no-prompts`는 스택 이름을 옵션이나 설정 파일에서 받아야 한다 |

`sam deploy`에서 이 파이프라인이 쓰는 옵션은 다음과 같다.

- `--capabilities` — IAM 리소스를 만드는 템플릿은 `CAPABILITY_IAM`(이름을 지정한 IAM 리소스면 `CAPABILITY_NAMED_IAM`)을 명시해야 하고, 없으면 `InsufficientCapabilities` 오류가 난다.
- `--resolve-s3` — 패키징용 S3 버킷을 자동으로 만든다. 계정에 `aws-sam-cli-managed-default` 스택이 생기는 이유다.
- `--confirm-changeset` — 실행 전에 변경 세트를 확인받는다. `--no-execute-changeset`은 변경 세트만 만들고 멈춘다.
- `--fail-on-empty-changeset` — 바뀐 것이 없을 때 0이 아닌 종료 코드를 낸다(기본 동작).

**`samconfig.toml`** 은 SAM CLI 설정 파일이다. 기본 위치는 `template.yaml`과 같은 폴더, 형식은 TOML(YAML도 지원)이다. `version = 0.1` 아래
`[<환경>.<명령>.parameters]` 표에 옵션을 적고, 키는 긴 옵션 이름의 `-`를 `_`로 바꾼 것(`stack_name`, `parameter_overrides`)이다.
`global`은 모든 명령에 적용된다. 명령별 값이 `global`보다, 명령줄 값이 설정 파일보다 우선한다. `--config-file` 경로는 템플릿 위치 기준이다.

## Use Cases

### 이 파이프라인이 SAM을 고른 이유

[[projects/aws-serverless/README|aws-serverless]] § 설계 근거에 적힌 내용이다.

- CloudFormation에 바로 이어지고, 무료이며, 콘솔 절차와 나란히 쓰기 쉽다.
- Serverless Framework v3는 지원이 끝났고, v4는 일정 매출 이상 조직에 유료 라이선스라 기본 구성으로 쓰지 않았다.

### 스택 2개의 경계와 파라미터 전달

| 스택 | 경계 | 리소스 | 넘기는 값 (Outputs) |
|---|---|---|---|
| `stack1-ingest` | 저장·전처리 | S3 버킷, ingest Lambda, DynamoDB 테이블(Stream 켬), DLQ·알람 | `TableStreamArn` 외 `BucketName`·`TableName`·`IngestFunctionName`·`DlqUrl` |
| `stack2-index` | 색인 | Stream 이벤트 소스 매핑, index Lambda, OpenSearch Serverless 컬렉션·보안 정책, DLQ·알람 | `CollectionEndpoint`·`DashboardEndpoint`·`IndexName`·`IndexFunctionName`·`DlqUrl` |

- stack2는 stack1의 `TableStreamArn`을 `Fn::ImportValue`가 아니라 **파라미터**로 받는다. 콘솔에서 값을 붙여넣을 수 있게 하려는 선택이다.
  stack2 템플릿의 `AllowedPattern`이 ARN 형식(`table/sls-.../stream/...`)을 검사하므로 자리표시자를 그대로 두면 컬렉션을 만들기 전에 실패한다.
- `Fn::ImportValue`로 묶으면 CloudFormation이 "가져다 쓰는 스택이 있는 동안 내보낸 스택을 지우거나 값을 바꿀 수 없다"를 강제한다.
  파라미터에는 이 연결이 없으므로 순서는 절차로 지킨다. 배포는 stack1 → stack2, 철거는 stack2 → stack1 순서다.
  테이블이 다시 만들어져 Stream ARN이 바뀌면 stack1 Outputs를 다시 복사해 stack2를 재배포한다.
- 나머지 파라미터: stack1은 `AlarmEmail`(필수) 하나. stack2는 `QueryPrincipalArns`·`AlarmEmail`(필수), `CollectionName`·`IndexName`·`TimestampField`(기본값 있음).

## Setup Notes

- **설정 파일 2벌** — 커밋된 `samconfig.toml`은 자리표시자만 있는 틀이다. 프로젝트마다 `samconfig.<project>.toml`로 복사해(git 무시) `stack_name`·`parameter_overrides`를 채운다.
  스택 이름이 이 파일에 남아 재배포·철거가 같은 스택을 친다. 이름을 바꾸면 새 스택이 생긴다. `profile`은 파일에 넣지 않고 `--profile sls-deployer`로 넘긴다.
- **커밋된 값** — `region = "ap-northeast-2"`, `cached`·`parallel = true`, `resolve_s3 = true`, `capabilities = "CAPABILITY_IAM"`, `confirm_changeset = false`,
  `fail_on_empty_changeset = false`. 마지막 값 때문에 바뀐 것이 없으면 `No changes to deploy`로 성공 종료한다. 코드를 고쳤는데 이 문구가 나오면 `sam build`를 건너뛴 것이다.
- **스택 이름은 `sls-`로 시작** — SAM이 만드는 실행 역할 이름이 스택명으로 시작하고, 배포 키는 `role/sls-*`만 만들 수 있다. 접두가 빠지면 role 생성이 거부되어 롤백된다.
  템플릿에 `RoleName`·`Role:`을 쓰지 않는다.
- **`Globals.Function`** — 런타임·아키텍처·`Timeout`·`MemorySize`·`PermissionsBoundary`를 스택의 모든 함수에 한 번에 건다. 값은 [[wiki/aws-lambda|AWS Lambda]] § Setup Notes.
- **빌드** — `PATH="$PWD/node_modules/.bin:$PATH" sam build`로 프로젝트의 esbuild를 찾게 한다. 산출물은 `.aws-sam/build`(커밋하지 않음).
  esbuild `Format`은 `cjs`로 고정한다(`esm` + AWS SDK 번들은 init에서 실패, 실측).
- `sam local`은 쓰지 않는다(Docker 필요, 실측과 차이). 순수 함수는 vitest로, AWS 호출은 배포 후 스모크로 확인한다.
- 절차: 빌드·배포·롤백·철거 공통은 [[projects/aws-serverless/config/skills/aws-lambda-deploy|aws-lambda-deploy]], stack1은 [[projects/aws-serverless/config/skills/aws-s3-ingest|aws-s3-ingest]],
  stack2는 [[projects/aws-serverless/config/skills/aws-dynamodb-stream|aws-dynamodb-stream]]과 [[projects/aws-serverless/config/skills/aws-opensearch|aws-opensearch]].

## Related Concepts

- [[wiki/serverless-data-pipeline|서버리스 데이터 파이프라인]] — 스택 2개로 나눈 전체 흐름
- [[wiki/aws-lambda|AWS Lambda]] — `AWS::Serverless::Function`이 만드는 함수·실행 역할·트리거
- [[wiki/aws-iam|AWS IAM]] — `CAPABILITY_IAM`, `role/sls-*` 제한, permissions boundary
- [[wiki/aws-s3|Amazon S3]] · [[wiki/aws-dynamodb|Amazon DynamoDB]] — stack1 리소스
- [[wiki/aws-opensearch-serverless|Amazon OpenSearch Serverless]] — stack2 리소스

## Open Questions

- stack1을 stack2보다 먼저 지웠을 때 stack2 이벤트 소스 매핑이 어떻게 되는지는 실측 기록이 없다(`미검증`). 지금은 철거 순서를 절차로만 지킨다.
- 스택 갱신이 기존 `sls-*` role의 신뢰 정책을 바꾸는 경우 배포 키의 `iam:UpdateAssumeRolePolicy` 거부에 걸리는지는 `미검증`([[projects/aws-serverless/guides/policy-design|정책 설계 근거]]).
- 공개본 이름(`Sls*`·`sls-`)으로 stack1·stack2 배포·스모크·철거를 다시 확인하기 전이다(`미검증`, [[projects/aws-serverless/README|aws-serverless]] § Status).
