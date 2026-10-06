---
type: tool
topics:
  - aws-serverless
status: draft
sources:
  - "https://docs.aws.amazon.com/IAM/latest/UserGuide/id.html"
  - "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_groups.html"
  - "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html"
  - "https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_identity-vs-resource.html"
  - "https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html"
  - "https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html"
  - "https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html"
  - "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html"
  - "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html"
  - "https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html"
  - "https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html"
  - "https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html"
  - "https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html"
  - "[[projects/aws-serverless/README|aws-serverless]]"
  - "[[projects/aws-serverless/guides/policy-design|정책 설계 근거]]"
  - "[[projects/aws-serverless/config/skills/aws-iam-access|aws-iam-access]]"
created: "2026-10-06"
updated: "2026-10-06"
---

# AWS IAM

## Summary

AWS IAM(Identity and Access Management)은 "누가(주체) 어떤 리소스에 어떤 조건으로 무엇을 할 수 있나"를 정하는 서비스다. 이 파이프라인에서 IAM 이 하는 일은 두 가지다. 하나는 배포 키 `sls-deployer` 가 파이프라인 밖으로 손을 뻗지 못하게 막는 것이고, 다른 하나는 Lambda 가 S3·DynamoDB·OpenSearch 에 접근할 실행 role 의 상한을 거는 것이다.

### 주체: 루트·사용자·그룹·역할

| 주체 | 정의 (AWS 문서) | 자격 증명 | 이 파이프라인에서 |
|---|---|---|---|
| 루트 사용자 | 계정을 만들 때 생기는 주체. 모든 서비스·리소스에 전체 접근 | 이메일·암호(+MFA) | 가입·결제 등 루트 전용 일에만 쓴다 |
| IAM 사용자 | 한 사람 또는 한 애플리케이션용 신원 | 장기 자격 증명(암호, 액세스 키) | `admin-<이름>`(콘솔+MFA), `sls-deployer`(CLI 전용) |
| 사용자 그룹 | 사용자 묶음. 그룹에 붙인 신원 기반 정책을 구성원이 받는다 | 없음 | `sls-operators` — 정책 2개를 여기에 붙인다 |
| 역할(role) | 특정 사람에게 묶이지 않고 필요한 주체가 맡는 신원 | 장기 자격 증명 없음, 맡을 때 임시 자격 증명 | Lambda 실행 role `sls-*` |

- 그룹은 리소스 기반 정책의 `Principal` 이 될 수 없다. 그룹은 인증이 아니라 권한을 묶는 단위이기 때문이다. 그룹 안에 그룹을 넣을 수도 없다. 역할을 누가 맡을 수 있는지는 **신뢰 정책**(trust policy)이 정한다. 신뢰 정책은 역할에 붙는 필수 리소스 기반 정책이다.
- **서비스 연결 역할**(service-linked role)은 서비스가 소유하는 역할이다. 관리자는 권한을 볼 수만 있고 편집할 수 없으며, 권한 경계도 붙일 수 없다. OpenSearch Serverless 는 첫 컬렉션을 만들 때 `AWSServiceRoleForAmazonOpenSearchServerless` 를 만든다.

### 신원 기반 정책 vs 리소스 기반 정책

- **신원 기반 정책**: 사용자·그룹·역할에 붙어 "이 신원이 무엇을 할 수 있나"를 정한다. 관리형(managed)과 인라인(inline)이 있다.
- **리소스 기반 정책**: S3 버킷, SQS 대기열, DynamoDB 테이블·스트림, KMS 키 같은 리소스에 붙어 "누가 이 리소스에 무엇을 할 수 있나"를 정한다. 인라인만 있다.
- 같은 계정 안에서는 두 정책의 허용이 합쳐진다(합집합). 어느 쪽이든 명시 거부가 있으면 거부다. 계정을 넘는 요청은 요청 쪽 신원 정책과 리소스 쪽 정책이 **둘 다** 허용해야 한다. OpenSearch Serverless 의 데이터 접근 정책은 IAM 정책과 별개인 서비스 자체 정책이다([[wiki/aws-opensearch-serverless|Amazon OpenSearch Serverless]] § 보안 정책 3종).

### 평가 순서: 명시적 Deny 우선

1. 기본값은 **암묵적 거부**(implicit deny)다. 루트 사용자만 예외다.
2. 적용되는 모든 정책(SCP·RCP, 리소스 기반, 신원 기반, 권한 경계, 세션 정책)에서 `Deny` 를 먼저 찾는다. 하나라도 걸리면 최종 결과는 거부다.
3. 명시 거부가 없으면 허용 문을 따진다. 허용 문이 없으면 암묵적 거부로 끝난다.

이 차이 때문에 `verify.sh` 는 거부 검사(V4)에서 `explicitDeny` 만 통과시킨다. `implicitDeny` 는 허용 문이 없다는 뜻일 뿐이라 GuardDeny 문이 빠진 것을 잡지 못한다(정책 설계 근거 § verify 체크 표).

### 권한 경계 (permissions boundary)

- 관리형 정책 하나로 사용자·역할이 가질 수 있는 **최대 권한**을 정한다. 경계는 그 자체로 권한을 주지 않는다. 실효 권한은 신원 기반 정책과 경계의 **교집합**이다. 어느 쪽이든 명시 거부가 있으면 거부다.
- 예외가 있다. 같은 계정에서 리소스 기반 정책이 **IAM 사용자 ARN** 에 직접 준 권한은 경계의 암묵적 거부로 제한되지 않는다. **역할 ARN** 에 준 권한은 제한된다. 위임할 때는 `iam:PermissionsBoundary` 조건 키로 "이 경계를 단 신원만 만들 수 있다"고 건다. AWS 문서의 위임 예시가 이 패턴이다.

### `iam:PassRole`

- 많은 서비스는 설정할 때 역할을 넘겨받아 나중에 그 역할로 동작한다(Lambda 함수의 실행 role). 역할을 넘기려면 넘기는 쪽에 `iam:PassRole` 권한이 있어야 한다. `PassRole` 은 API 호출이 아니라 권한이다. 그래서 CloudTrail 에 `PassRole` 이벤트가 남지 않는다. 어떤 role 이 넘어갔는지는 `CreateFunction` 같은 리소스 생성 로그에서 본다.
- 범위는 `Resource`(넘길 수 있는 role ARN)와 `iam:PassedToService`(받을 서비스)로 좁힌다. 자기보다 권한이 큰 role 을 서비스에 넘기면 서비스가 그 권한으로 대신 행동한다. 이것이 권한 상승 경로다.

### 액세스 키와 CLI 프로파일

- 액세스 키는 IAM 사용자나 루트의 **장기** 자격 증명이다. 액세스 키 ID 와 비밀 액세스 키 두 부분으로 되어 있다. 비밀 키는 만들 때만 볼 수 있고, 사용자당 최대 2개까지 만들 수 있다. AWS 는 가능하면 역할 같은 임시 자격 증명을 권장한다. 공유 자격 증명 파일 `~/.aws/credentials` 는 평문으로 저장된다. 앱 파일이나 프로젝트 폴더에 키를 두지 않는다.
- 프로파일을 지정하지 않으면 `default` 프로파일이 쓰인다. 다른 프로파일은 `--profile <이름>` 이나 `AWS_PROFILE` 환경 변수로 고른다. 섹션 이름은 `config` 에서 `[profile <이름>]`, `credentials` 에서 `[<이름>]` 이다.

### 루트 MFA 와 최소 권한

- AWS 는 루트 사용자 전용 작업이 아니면 루트를 쓰지 말고, 일상 작업용으로 관리자 사용자를 만들라고 권한다. 루트에는 MFA 를 단다. MFA 장치는 최대 8개까지 등록할 수 있고, 모든 계정 유형에서 루트 MFA 가 요구된다. MFA 가 없으면 첫 콘솔 로그인 시도 후 35일 안에 등록해야 한다. 루트 액세스 키는 만들지 않는다.
- 최소 권한: 작업에 필요한 권한만 준다. 정책은 IAM Access Analyzer 의 정책 검증(100개 넘는 검사)으로 확인하고, 쓰지 않는 사용자·역할·권한·자격 증명은 정기적으로 지운다. 관리형 정책 크기 상한은 6,144자(공백 제외)이고, 사용자당 관리형 정책은 기본 10개, 역할당 20개다.

## Use Cases

- **세 단계 신원**: 루트(가입·결제) → `admin-<이름>`(`AdministratorAccess`+MFA, 일상 관리) → `sls-deployer`(배포 키, CLI 전용). 사람이든 에이전트든 배포는 배포 키로만 한다.
- **Lambda 실행 role**: SAM 이 함수마다 `sls-*` role 을 만들고 `SlsLambdaBoundary` 를 경계로 붙인다. 함수가 무엇을 하든 실효 권한은 경계 안이다.
- **OpenSearch 데이터 접근**: 데이터 접근 정책의 주체로 함수 role 과 `QueryPrincipalArns`(관리자·배포 키 사용자)의 IAM ARN 을 쓴다.

### 이 파이프라인의 정책 3개 (요약)

| 정책 | 붙는 곳 | 요지 |
|---|---|---|
| `SlsServerlessAllow` | 그룹 `sls-operators` | 파이프라인 서비스 9개 허용, `role/sls-*` 는 경계를 단 것만 생성, `iam:PassRole` 은 `lambda.amazonaws.com` 에만 |
| `SlsGuardDeny` | 그룹 `sls-operators` | `NotAction` 으로 허용목록 밖 전부 거부, 권한 상승·비용 폭탄·공개 노출·외부 공유·서울 밖 리전 명시 거부 |
| `SlsLambdaBoundary` | 함수 role (경계) | Lambda 가 쓸 서비스의 상한, GuardDeny 의 비용·노출·공유 Deny 미러 |

각 문(Sid)의 이유, 정책으로 못 막아 `verify.sh` 로 넘긴 것, 정책이 못 막는 비용은 [[projects/aws-serverless/guides/policy-design|정책 설계 근거]] 에 있다.

## Setup Notes

설치 절차는 스킬에 있다. 여기는 이 파이프라인에서 어떻게 설정돼 있는지만 적는다.

- 정책 정본은 `projects/aws-serverless/config/policies/*.json` 한 벌이다. 발급·검증·정리 절차는 [[projects/aws-serverless/config/skills/aws-iam-access|aws-iam-access]] 에 있다.
- 계정 쪽 설정(루트 MFA, 루트 키 없음, 관리자 사용자 `admin-<이름>`)은 [[projects/aws-serverless/config/skills/aws-account-setup|aws-account-setup]] 의 1·5번이다. `verify.sh` V9 가 `AccountMFAEnabled` 1, `AccountAccessKeysPresent` 0 을 본다.
- 배포 작업자 환경에서는 `aws configure --profile sls-deployer` 로 등록한다. 명령 전에 `export AWS_PROFILE=sls-deployer AWS_REGION=ap-northeast-2` 를 한다(기본 프로파일이 다른 계정일 수 있다).
- 템플릿 `Globals.Function.PermissionsBoundary: arn:aws:iam::${AWS::AccountId}:policy/SlsLambdaBoundary` 가 모든 함수 role 에 경계를 붙인다. 스택 이름은 `sls-` 로 시작해야 한다. 그렇지 않으면 role 이름이 `role/sls-*` 를 벗어나 생성이 거부된다.
- 정책을 바꾸면 계정 관리자 자격으로 `aws accessanalyzer validate-policy` 를 돌려 0 finding 을 확인하고, `verify.sh` 를 다시 돌린다. 실측에서 `create-policy-version` 과 정책 시뮬레이터는 존재하지 않는 액션명을 잡지 못했다(3건). IAM 전파 지연 때문에 실호출 음성 확인은 적용 3분 뒤에 한다(88초 뒤 통과한 실측, README § 검증 메모). `SlsGuardDeny` 는 2026-10-02 기준 5,311자로 상한 6,144자까지 약 830자 남았다(정책 설계 근거 § 정책을 바꿀 때).

## Related Concepts

- [[wiki/serverless-data-pipeline|서버리스 데이터 파이프라인]] — 이 권한 구조가 지키는 전체 흐름
- [[wiki/aws-lambda|AWS Lambda]] — 실행 role 과 `iam:PassRole`
- [[wiki/aws-sam|AWS SAM]] — 함수 role 과 경계를 만드는 배포 도구
- [[wiki/aws-opensearch-serverless|Amazon OpenSearch Serverless]] — IAM 과 별개인 데이터 접근 정책, 서비스 연결 role
- [[wiki/aws-s3|Amazon S3]] — 버킷 정책(리소스 기반 정책)과 계정 수준 퍼블릭 액세스 차단
- [[wiki/aws-dynamodb|Amazon DynamoDB]] — 테이블·스트림 리소스 기반 정책

## Open Questions

- 리소스 이름을 `Sls*`·`sls-` 로 바꾼 공개본은 실계정 재실측 전이다(`미검증`). 정책 문장은 이전 이름으로 검증한 것과 같다.
- 스택 갱신이 기존 role 의 신뢰 정책을 바꾸는 경우가 있는지는 `미검증`이다. 배포 키는 `iam:UpdateAssumeRolePolicy` 가 거부라 그런 갱신이 막힐 수 있다.
- 다른 계정의 정책 ARN 을 권한 경계로 받는지는 실측하지 않았다(`미검증`, 정책 설계 근거 § SlsGuardDeny).
- IAM Access Analyzer 외부 접근 분석기를 상시 감지에 쓸 때의 요금·설정 절차는 `미검증`.
- AWS 는 장기 액세스 키 대신 임시 자격 증명을 권장한다. 이 파이프라인은 범위상 IAM 사용자 키를 쓰고, SSO·AssumeRole 은 다루지 않으며 배포 키는 `sts:AssumeRole` 이 거부다. 임시 자격 증명으로 옮길지는 열려 있다.
