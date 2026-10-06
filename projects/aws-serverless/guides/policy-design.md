# 정책 설계 근거 — SlsServerlessAllow · SlsGuardDeny · SlsLambdaBoundary

> 개념: [AWS IAM](../../../wiki/aws-iam.md)

> `미검증` — 이 이름(`Sls*` 정책 · `sls-` 접두어 · `sls-deployer`)으로는 실계정 재실측 전이다. 같은 구조(정책 문장·조건·verify 검사 동일, 이름만 다름)를 이전 이름으로 실계정에서 검증했다(2026-09-23~09-29). 이 문서의 "실측"은 모두 그 검증 결과다.

정책을 고치려는 사람이 읽는 글이다. 정본 파일은 [`../config/policies/`](../config/policies/) 의 JSON 6개(배포 키용 3개 — 이 문서의 대상, 실무자용 3개 — § 실무자 권한 유형), 판정 스크립트는 [`../config/scripts/verify.sh`](../config/scripts/verify.sh).
발급 절차는 [02-restricted-key.md](02-restricted-key.md), 계정 쪽 설정(MFA·예산·용량 상한·퍼블릭 차단)은 [01-aws-account-setup.md](01-aws-account-setup.md), 실무자 권한 유형은 [03-staff-access.md](03-staff-access.md)(§ 실무자 권한 유형).

---

## 왜 제한 키인가

배포 키로 할 수 있는 것은 서울 리전(`ap-northeast-2`)에서 파이프라인 서비스(S3·Lambda·DynamoDB·OpenSearch Serverless·CloudWatch Logs/Metrics·SQS·SNS·CloudFormation)를 만들고 지우는 것, 그 Lambda 의 실행 역할(`role/sls-*`, `SlsLambdaBoundary` 부착 조건)을 만드는 것, 비용과 자기 자신을 조회하는 것까지다.
그 밖의 서비스(Bedrock·EC2·RDS 등), 서울 밖 리전, 사용자·키·정책 생성, 다른 역할로 전환, 계정·결제 변경, 데이터 외부 공유·공개 노출, 되돌릴 수 없는 비용 액션은 명시 거부다.
`AdministratorAccess` 키는 허용목록이 없으니 다 열려 있다는 뜻이라 쓰지 않고(verify.sh V2 가 반려), `PowerUserAccess` 도 Bedrock 이 열려 있어 쓰지 않는다. 허용 밖 서비스 하나(예: Bedrock)가 열려 있는 것만으로 비용 사고가 난다는 것이 이 설계의 출발점이다.

키(그룹 `sls-operators`)에는 Allow·GuardDeny 두 정책만 붙는다. `SlsLambdaBoundary` 는 계정에 이 이름으로 존재만 하면 되고, SAM `Globals.Function.PermissionsBoundary` 가 키가 만드는 모든 함수 role 에 붙인다. 실무자 유형 정책 3개(§ 실무자 권한 유형)는 배포 키에 붙지 않는다.

---

## 정책 3개 구조

원칙 세 가지.

1. **서비스 허용목록.** 파이프라인에 쓰는 서비스만 연다. 새 서비스가 필요하면 정책을 새 판으로 바꾼다(§ 정책을 바꿀 때).
2. **IAM 은 role 생성만, `role/sls-*` + 바운더리 한정.** Lambda 가 S3·DynamoDB·OpenSearch 에 접근하려면 실행 role 이 필요하다. 그 role 은 이름이 `sls-` 로 시작하고 `SlsLambdaBoundary` 를 permissions boundary 로 단 것만 만들 수 있어(`iam:PermissionsBoundary` 조건), 어떤 인라인·관리형 정책을 붙여도 실효 권한은 바운더리 안이다. 사용자·그룹·키·정책·OIDC/SAML 공급자 생성은 막는다 — 키가 자기 권한을 넓히지 못하게.
3. **명시 거부를 구조로 둔다.** `NotAction` 한 문으로 허용목록 밖 서비스를 전부 거부한다 — 서비스가 늘어도 거부목록을 따라잡을 필요가 없고, 나중에 누가 `AdministratorAccess` 를 더 붙여도 Deny 가 이긴다. 단 `iam` 은 `NotAction` 예외라 **Deny 문에 적힌 IAM 액션만** 막힌다 — IAM 쪽 Deny 문이 많은 이유다. Admin 이 붙으면 허용목록 서비스의 리소스 범위는 넓어지므로 V2 가 "정확히 2개"를 강제하고 재검증 때마다 다시 본다.

정책 JSON 은 이전 이름 판과 이름 치환 외 동일하다(diff 확인).

### SlsServerlessAllow — 허용목록

| Sid | 범위 | 이유 |
|---|---|---|
| `PipelineServices` | `s3` `lambda` `dynamodb` `aoss` `logs` `cloudwatch` `sqs` `sns` `cloudformation` 전체(`*`) | 파이프라인 서비스. `aoss` 는 OpenSearch **Serverless**(관리형 도메인이면 `es:*` 추가). `sqs`·`sns` 는 DLQ·알람 이메일용. `cloudformation:*` 은 SAM 배포에 필수(`sam deploy` 는 스택 생성). `events:*` 는 뺐다 — 템플릿이 쓰지 않고, `events:PutPermission` 은 default 버스를 `*` 에 여는 경로였다 |
| `LambdaRoleReadTagDelete` | `role/sls-*` 조회·수정·태그·삭제, 인라인 정책 조회·삭제, 관리형 분리 | role 정리용. `iam:UpdateAssumeRolePolicy` 는 일부러 없다(GuardDeny 가 명시 거부) — 신뢰 대상을 외부 계정으로 돌리면 키를 지워도 접근이 남는다. role 생성 시점에 신뢰 정책이 함께 들어가므로 배포에는 필요 없다고 본다. 스택 갱신이 기존 role 의 신뢰 정책을 바꾸는 경우는 `미검증` |
| `LambdaRoleWriteOnlyWithBoundary` | `role/sls-*` 에 `CreateRole`·`PutRolePolicy`·`AttachRolePolicy`·`PutRolePermissionsBoundary` — `iam:PermissionsBoundary` 가 `SlsLambdaBoundary` 일 때만 | SAM 은 role 생성 시점에 바운더리를 붙이므로 뒤따르는 인라인 정책 Put 도 조건을 만족한다. SAM 템플릿의 role 이름은 반드시 `sls-` 로 시작해야 한다(스택명 접두) |
| `PassRoleOnlyToLambda` | `role/sls-*` 를 `lambda.amazonaws.com` 에만 PassRole | 실행 role 을 다른 서비스에 넘겨 그 권한을 쓰는 경로 차단 |
| `OpenSearchServerlessServiceLinkedRole` | `AWSServiceRoleForAmazonOpenSearchServerless` 하나만 생성 | 첫 컬렉션 생성이 이 role 을 만든다. 막혀 있으면 `explicit deny` 로 CloudFormation 이 롤백된다(실측 09-23) |
| `ManagedPolicyReadForAttach` | `GetPolicy`·`GetPolicyVersion`·`ListPolicies`·`ListRoles` | `AttachRolePolicy` 로 AWS 관리형 정책(예: `AWSLambdaBasicExecutionRole`)을 붙일 때 조회가 필요하다. 붙일 수 있는 정책은 GuardDeny 가 4개로 제한한다 |
| `SelfInspectionOwnUser` · `SelfInspectionOwnGroup` · `SelfInspectionAccount` | 자기 사용자(`user/${aws:username}`)·자기 그룹(`group/sls-operators`)·계정 요약·`sts:GetCallerIdentity` | verify.sh 가 쓰는 읽기 권한. 리소스를 자기 것으로 좁혀 다른 사용자의 키 목록·정책 본문은 볼 수 없다. `iam:GetLoginProfile` 은 V2b 용. `iam:ListMFADevices` 는 스크립트가 쓰지 않아 뺐다 |
| `CostReadOnly` | `ce:GetCostAndUsage`·`ce:GetCostForecast`·`budgets:ViewBudget` | 비용 조회. 계정 관리자가 원치 않으면 이 Sid 만 빼고 예산 알림 수신으로 대체할 수 있다. `budgets:DescribeBudgets` 는 존재하지 않는 액션이라 뺐다(§ 정책을 바꿀 때) |

### SlsGuardDeny — 명시 거부

| Sid | 거부 범위 | 이유 |
|---|---|---|
| `DenyEverythingOutsideAllowlist` | `NotAction`: 허용목록 9개 서비스 + `iam:*` + `sts:GetCallerIdentity` + 비용 읽기 + KMS 데이터 액션 5개 밖 전부 | Bedrock·EC2 는 물론 savingsplans·marketplace·route53domains 같은 장기 약정도 이름을 몰라도 막힌다. KMS 5개(`Encrypt`·`Decrypt`·`GenerateDataKey*`·`DescribeKey`·`CreateGrant`) 예외는 Lambda 환경 변수 암호화가 AWS 관리형 키 `aws/lambda` 를 키 정책 경유로 쓰기 때문 — 명시 거부는 키 정책의 허용도 이긴다(실측 09-23 롤백 `kms:Encrypt … explicit deny`). Allow 에 kms 가 없으므로 고객 관리형 키는 여전히 못 만들고 못 쓴다 |
| `DenyIdentityCreationAndPrivilegeEscalation` | 사용자·액세스 키·로그인 암호·그룹·사용자/그룹 정책·정책/정책 버전·인스턴스 프로파일·MFA 장치 생성·비활성화, 사용자/role 바운더리 삭제, `UpdateAssumeRolePolicy`, `sts:AssumeRole`, OIDC/SAML 공급자 생성·갱신 | 키가 자기 권한을 넓히는 경로 전부. `sts:AssumeRole` 거부는 다른 role 로 갈아타기를 막는다(Lambda 서비스가 role 을 assume 하는 것과는 무관). OIDC/SAML 은 외부 IdP 를 신뢰하는 role 을 만드는 첫 단계. `DeleteRolePermissionsBoundary` 는 여기서 무조건 거부 |
| `DenyRoleWriteWithoutLambdaBoundary` | `iam:PermissionsBoundary` 가 `SlsLambdaBoundary` 가 아니면(키가 없어도 `ArnNotLike` 가 참) role 생성·인라인 정책·관리형 부착·바운더리 교체 거부 | role 에 `"Action":"*"` 인라인을 붙여 Lambda 로 실행하는 우회를 닫는다. 조건 ARN 의 계정 자리가 `*` 인 것은 바운더리가 같은 계정의 관리형 정책이어야 한다는 IAM 규칙에 기댄 것이다(`미검증` — 다른 계정 정책 ARN 을 바운더리로 받는지 실측 안 함) |
| `DenyRoleWriteOutsideSlsPath` · `DenyPassRoleOutsideSlsPath` · `DenyPassRoleToOtherServices` | `role/sls-*` 밖 role 의 생성·삭제·수정·정책·신뢰 정책·바운더리·태그 변경, `sls-*` 밖 role 의 PassRole, lambda 밖 서비스로의 PassRole | Allow 부재(implicit deny)로만 두면 나중에 붙는 관리형 정책이 이를 연다. 원칙 3 의 "Deny 가 이긴다"를 IAM 에서도 성립시키는 문이다 |
| `DenyRolesWithPath` | `role/*/*`(경로 붙은 role) 의 생성·PassRole·정책 쓰기·바운더리·수정·태그 | `role/sls-*` 의 `*` 는 `/` 도 삼켜 `role/sls-x/이름` 같은 경로 role 이 접두사 검사를 우회한다. 경로 없는 `sls-*` role 만 쓰이게 한다 |
| `DenyAttachingManagedPoliciesOutsideLambdaSet` | `AttachRolePolicy` 는 `AWSLambdaBasicExecutionRole`·`AWSLambdaDynamoDBExecutionRole`·`AWSLambdaSQSQueueExecutionRole`·`AWSXrayWriteOnlyAccess` 만 | X-Ray 쓰기는 `Tracing: PassThrough` 여도 SAM 이 붙인다(실측). 바운더리가 있어도 이중으로 막는다 |
| `DenyServiceLinkedRoleExceptOpenSearchServerless` | `iam:AWSServiceName` ≠ `observability.aoss.amazonaws.com` 인 서비스 연결 role 생성 | Allow 의 aoss 예외 하나만 남긴다 |
| `DenyCostBombsInsideAllowedServices` | aoss 계정 용량 설정·컬렉션 그룹 생성/수정, Lambda 프로비저닝 동시성·재귀 루프 감지 설정(`PutFunctionRecursionConfig`), DynamoDB 글로벌 테이블·복제본·예약 용량 구매, S3 Object Lock·객체 보존·법적 보존 | 허용목록 안에서 요금이 튀거나 되돌릴 수 없는 액션. 컬렉션 그룹은 계정 단위 최대 OCU(01 § 3.6) 밖에서 자기 최소·최대(최소 1,696 까지, 과금은 최소값, 최대 미지정 시 96)를 가진다 — 이 Deny 가 없던 판의 키로 빈 그룹 생성이 실제로 됐다(실측 09-29). Object Lock 컴플라이언스 보존은 루트도 못 지운다(철거 불가). 예약 용량은 되돌릴 수 없는 약정. 이 설정들은 계정 관리자만 바꾼다 |
| `DenyPublicExposureAndExfiltration` | 계정 수준 퍼블릭 액세스 차단 변경(`s3:PutAccountPublicAccessBlock`), DynamoDB PITR export, 로그 구독 필터, Lambda 레이어 공개 권한 | `Delete*PublicAccessBlock` 액션은 존재하지 않는다(콘솔 검증기 09-24). 버킷 단위 `PutBucketPublicAccessBlock`·`PutBucketPolicy` 는 SAM 이 쓰므로 키에서 못 막는다 — 계정 수준 차단(01 § 3.7, 신규 계정은 비어 있음, 실측 09-24)이 그 문이고 V9 가 켜졌는지 본다 |
| `DenyCrossAccountSharingInsideAllowedServices` | 21개: DynamoDB 리소스 정책, SQS·SNS `AddPermission`, 로그 리소스 정책·대상·대상 정책·계정 정책·내보내기, aoss 보안 설정(SAML 등), S3 ACL·소유권 제어·접근점·인벤토리·분석·로깅·복제 | 허용목록 서비스 안에서 데이터를 다른 계정에 내주는 축. **`s3:PutBucketPolicy` 는 일부러 뺐다** — SAM 관리 버킷 스택(`aws-sam-cli-managed-default`)이 버킷 정책을 쓴다 |
| `DenyUnauthenticatedFunctionUrl` | `lambda:FunctionUrlAuthType` = `NONE` 인 Function URL 생성·수정 | 인증 없는 공개 URL 차단. `AWS_IAM` 은 허용 |
| `DenyLambdaPermissionOutsideServiceSet` | `lambda:Principal` 이 서비스 주체 5개(s3·sns·sqs·events·logs)가 아니면 `lambda:AddPermission` 거부 | `StringEquals lambda:Principal = "*"` 로 쓰면 리터럴 `*` 만 잡혀 외부 계정 ID 가 통과한다 — 그래서 `StringNotEquals` 허용목록이다. SAM 의 S3 이벤트 권한(`s3.amazonaws.com`)은 통과한다(실측 09-24) |
| `DenyOutsideSeoulRegion` | `aws:RequestedRegion` ≠ `ap-northeast-2`. 예외(`NotAction`)는 글로벌 서비스 `iam`·`sts`·`ce`·`budgets`·`s3:ListAllMyBuckets`·`s3:GetBucketLocation` | `s3:ListAllMyBuckets` 가 없으면 `aws s3 ls` 가 실패한다 |

### SlsLambdaBoundary — 함수 role 의 권한 상한

| Sid | 범위 | 이유 |
|---|---|---|
| `LambdaMayUseOnlyPipelineServices` | s3·dynamodb·aoss·logs·sqs·sns·cloudwatch 전체 + `xray:PutTraceSegments`·`xray:PutTelemetryRecords` | Lambda 가 실제로 쓰는 것은 logs·s3·dynamodb·aoss·sqs 뿐이지만 바운더리는 "상한"이라 허용목록 서비스로 둔다. `lambda`·`cloudformation` 은 없다 — 함수가 함수를 만들 이유가 없다 |
| `DenyCostBombs` | GuardDeny 비용 Deny 중 aoss·DynamoDB·S3 Object Lock·예약 용량 13개 미러 | GuardDeny 는 사용자 키에만 붙는다. 배포 작업자가 role 인라인 정책에 `aoss:*` 를 넣고 Lambda 를 호출하면 `aoss:UpdateAccountSettings` 가 Lambda 명의로 실행되는 경로가 있었다. 바운더리의 Deny 는 role 의 실효 권한을 자르므로 이 경로가 닫힌다 |
| `DenyPublicExposureAndExfiltration` | `PutAccountPublicAccessBlock`·`PutBucketPublicAccessBlock`·`PutBucketPolicy`·`PutBucketAcl`·`PutObjectAcl`·DynamoDB export·로그 구독 필터 | GuardDeny 보다 넓다 — Lambda 는 버킷 정책을 만질 이유가 없다 |
| `DenyCrossAccountSharing` | dynamodb·sqs·sns·logs·aoss 공유 액션 + `s3:PutObjectVersionAcl` (12개) | GuardDeny 공유 Deny 와 같은 축의 미러 |
| `DenyOutsideSeoulRegion` | 서울 밖 거부, 예외 `s3:ListAllMyBuckets`·`s3:GetBucketLocation` | 서울 밖은 여기서도 거부 |

키·그룹에 붙이지 않는다. 계정에 이 이름으로 있어야 하고(02 § 2.1), SAM 템플릿 `Globals.Function.PermissionsBoundary: arn:aws:iam::${AWS::AccountId}:policy/SlsLambdaBoundary` 가 모든 함수 role 에 붙인다.

### 정책으로 못 막아 verify.sh 로 넘긴 것

- **PassRole 에는 바운더리 조건을 걸 수 없다.** 계정에 원래 있던 바운더리 없는 `sls-*` role, 다른 role 로 도는 Lambda 함수(`UpdateFunctionCode` 는 그 함수 role 권한으로 코드를 돌린다), `RoleARN` 이 붙은 스택(`UpdateStack` 이 그 role 을 재사용)은 키가 그 role 의 권한을 빌리는 통로다 → V9c 가 반려로 잡는다. 그래서 키는 전용 새 계정에만 발급한다.
- **role 신뢰 정책 내용은 IAM 조건 키로 제한할 수 없다.** 기존 role 의 신뢰 대상 교체는 `UpdateAssumeRolePolicy` 명시 거부로 닫았다. 새로 만드는 `sls-*` role 의 신뢰 정책에 외부 계정을 넣는 것은 `CreateRole` 조건 키로 못 막아 V9b(재검증 때마다)와 사용 종료 점검(02 § 4 의 3번)으로 잡는다. 계정 관리자가 IAM Access Analyzer(외부 접근 분석기)를 켜면 상시 감지가 된다(요금·설정 절차 `미검증`).

---

## 실무자 권한 유형 — SlsStaffPush · SlsStaffQuery · SlsStaffEdit

배포 키와 별개로, 파이프라인이 선 뒤 실무자(조직의 데이터를 올리고 보는 사람)가 데이터를 직접 쓰게 하는 키 세 종류다. 절차는 [03-staff-access.md](03-staff-access.md)(3부), 정책 원문은 [`../config/policies/`](../config/policies/) 의 `SlsStaff*.json`, 판정 표는 [`../config/scripts/staff-policy-sim.sh`](../config/scripts/staff-policy-sim.sh)(47행 + 린터 3개, 끝 줄 `== result: PASS ==`). 이 절의 실측(2026-10-01~10-02)도 맨 위 주의대로 이전 이름으로 했다. 크기(공백 제외, 2026-10-06): Push 338 · Query 918 · Edit 243자.

| 그룹 | 부착 정책 | 되는 것 |
|---|---|---|
| `sls-staff-push` | Push + GuardDeny | 데이터 버킷 `sls-*-data-*` 에 올리기, 파일 이름 보기 |
| `sls-staff-query` | Query + GuardDeny | 데이터 버킷 읽기(옛 버전 `s3:GetObjectVersion` 포함), 표 `sls-*-docs` 와 그 인덱스 읽기, 검색 읽기(읽기 정책에 든 경우) |
| `sls-staff-edit` | Query + Edit + GuardDeny | 조회 전부 + 표 항목 `PutItem`·`UpdateItem`·`DeleteItem`·`BatchWriteItem` |

- **수정 = 조회 정책 + 쓰기분 정책.** 읽기를 두 파일에 중복하지 않고 읽기·쓰기 경계가 파일로 보인다. 그래서 Edit 만 붙이면 읽기가 안 된다(판정 표 X1, 실호출 `AccessDeniedException … dynamodb:Query`).
- **다른 유형의 액션은 `implicitDeny` 다.** S3·DynamoDB·aoss 는 GuardDeny 의 `NotAction` 허용 목록 안이라 Allow 가 없어서 막힌다. `explicitDeny` 는 서울 밖·허용 목록 밖 서비스·IAM 권한 상승뿐이다.
- **사용자·그룹 규칙.** 사용자는 `staff-<영문이름>`, 콘솔 액세스 없이 액세스 키만. 한 사람이 두 유형이면 사용자를 둘 만들지 않고 그룹 둘에 넣는다. 정책을 사용자에 직접 붙이지 않는다.
- **검색은 두 겹이다.** IAM 쪽 `aoss:APIAccessAll` 은 `collection/*` 다(컬렉션 ARN 은 이름이 아니라 ID 라 접두사로 못 좁힌다). 어느 컬렉션의 어떤 문서를 읽는지는 데이터 접근 정책 `<컬렉션>-read` 가 정한다. 콘솔 검토 화면에 OpenSearch Serverless "쓰기" 가 보이는 것은 `APIAccessAll` 의 접근 수준 분류 때문이다 — 문서 쓰기·인덱스 삭제는 읽기 정책이 막는다(실호출 403).
- **스트림 액션은 없다.** `GetRecords` 등은 어느 유형에도 없고, 표 패턴 `table/sls-*-docs` 는 스트림 ARN(`…-docs/stream/…`)에 맞지 않는다. 유형 정책에 스트림 액션을 더하지 않는다.
- **GuardDeny 를 같이 붙이는 이유** — 허용 목록 밖 서비스·서울 밖 리전·IAM 권한 상승이 `explicitDeny` 로 남아, 누가 실무자 그룹에 넓은 정책(`AdministratorAccess` 등)을 덧붙여도 그 셋은 막힌다. 2부에서 만든 것을 재사용해 V8 이 이미 원문을 대조한다(6,144자 중 5,311자를 써서 실무자용 문을 더할 여유도 적다). 대가는 `DenyIdentityCreationAndPrivilegeEscalation` 이 `iam:CreateAccessKey` 를 거부해 실무자가 자기 키를 만들거나 바꾸지 못한다는 것 — 재발급은 계정 관리자가 하고(3부 7절), 배포 키를 정리할 때 실무자 그룹이 있으면 GuardDeny 를 지우지 않는다.
- **뺀 유형** — 처리기(Lambda 생성): 코드로 `SlsLambdaBoundary` 범위 전부를 쓸 수 있어 배포 키와 실질 차이가 없다. 대시보드(OpenSearch Dashboards 를 브라우저로 여는 실무자): 콘솔 로그인과 MFA 가 필요해 키만 쓰는 구조와 맞지 않는다 — 대시보드를 만드는 사람은 조회 유형 키로 데이터를 읽어 바깥 도구에서 만든다.
- **검색 읽기 정책을 스택 밖에 둔 이유** — 실무자 ARN 을 `QueryPrincipalArns` 에 넣으면 스택이 만드는 `<컬렉션>-data` 의 `aoss:*` 전권이 간다. 데이터 접근 정책은 권한을 더하기만 하고 명시 거부가 없어, 그 목록에 든 실무자의 읽기 제한을 다른 정책으로 되돌릴 수 없다. 실무자 목록을 별도 스택 파라미터로 두면 배포 키를 지운 뒤 실무자를 더할 길이 스택 재배포뿐이고, 스택과 콘솔을 섞으면 재배포가 콘솔 수정분을 되돌린다. 그래서 계정 관리자가 콘솔에서 `<컬렉션>-read` 를 만들고 고친다. 템플릿은 바꾸지 않았다.
- **읽기 정책 실측(2026-10-02)** — ① 없는 사용자 ARN 도 그대로 저장된다(사람이 나갈 때 사용자를 지우기 전에 읽기 정책에서 뺀다) ② 컬렉션이 없어도 콘솔 시각 편집기로 만들어지고, 대상이 빈 정책은 `Principal: there must be a minimum of 1 items` 로 저장되지 않는다 ③ 스택 ② 를 지웠다 같은 컬렉션 이름으로 다시 만들면 정책을 고치지 않아도 이어진다(검색 주소는 바뀐다. 삭제 도중 한 번 저장한 한계가 있다) ④ 더하기·빼기 반영 40~45초 ⑤ `awscurl --service aoss --region ap-northeast-2` 서명을 Serverless 가 받는다(`--region` 을 빼면 이유 없는 403) ⑥ 없는 인덱스의 삭제는 권한과 무관하게 404 라 인덱스 삭제 거부는 빈 인덱스로 판정했다(403).
- **그 밖의 실측** — 판정 표 47행 + 린터 3 PASS, 변조 대조, V8b 변조·원복·조회 실패 분기(실계정), 유형별 실호출, 콘솔 정책 편집기 린터 세 정책 모두 0, 컬렉션 약 21분 당일 철거.

**알려진 한계** — 정책으로 막지 않고 3부의 안내와 종료 점검(`../config/skills/aws-iam-access.md` § 사용 종료·정리 6번)으로 다룬다. L1·L2 는 판정 표의 NOTE 행이 결과를 고정한다.

| # | 한계 | 근거·대응 |
|---|---|---|
| L1 | ARN 의 `*` 는 `/` 까지 삼킨다. 객체 패턴 `sls-*-data-*/*` 가 `sls-` 로 시작하는 **다른 버킷**의 `…-data-…` 키 경로와도 맞아, 적재 키가 그 버킷에 올릴 수 있다 | 판정 표 `sls-other/x-data-y/z` 에 `PutObject`=allowed. 파이프라인 계정의 `sls-` 버킷은 데이터 버킷과 검증용 `sls-probe-*` 뿐 — `sls-` 로 시작하는 다른 버킷을 만들 때 이름과 함께 다시 본다 |
| L2 | 같은 이유로 `table/sls-*-docs` 가 다른 `sls-` 표의 이름이 `-docs` 로 끝나는 인덱스(`table/sls-x/index/…-docs`)와 맞아 조회·수정 조합이 그 인덱스를 읽는다. 쓰기는 인덱스 리소스 타입이 없어 영향 없다 | 판정 표 `table/sls-test-orders/index/by-docs` 에 `Query`=allowed. 표 이름을 정확히 적으면 닫히지만 배포마다 정책 파일이 달라져 택하지 않았다 |
| L3 | 스택 ① 이 만든 표가 아니어도 이름이 `sls-<x>-docs` 면 패턴에 맞아 읽기·쓰기가 된다 | 패턴의 정의. `sls-` 접두사는 파이프라인 전용으로 쓴다 |
| L4 | 스택 이름이 정확히 `sls` 면 표 `sls-docs`·버킷 `sls-data-<계정>` 이 패턴에서 빠져 실무자만 거부된다(닫히는 쪽) | 스택 이름은 `sls-<무엇>` 이어야 한다 |
| L5 | 계정 고정(`aws:ResourceAccount`)·IP(`aws:SourceIp`) 조건이 없다. 새어 나간 키는 어디서든 쓰이고, 다른 계정이 자기 `sls-*-data-*` 버킷을 버킷 정책으로 열어 주면 적재 키가 거기에 올릴 수 있다 | 의도한 선택(2026-10-01). 대응은 키 비활성화(3부 7절)와 마지막 사용 열 점검(3부 6절) |
| L6 | 적재: 같은 이름으로 다시 올리면 새 버전이 최신이 되고 검색에도 새 버전이 최신으로 보인다(옛 버전은 남고, 지우기는 못 한다). `s3:ListBucket` 으로 파일 이름이 보인다 | 실호출: 같은 `docId` 의 버전 행 2개. 덮어쓰기 금지 조건(`s3:if-none-match`)은 실측 전이라 넣지 않았다 |
| L7 | 조회: `s3:GetObject` 가 있는 키는 presigned URL 을 만들 수 있고, 그 URL 은 받은 사람 누구나 최대 7일 연다. `Scan` 은 읽은 만큼 과금된다 | AWS 문서(presigned URL). 수명 제한 조건(`s3:signatureAge`)은 실측 전이라 넣지 않았다 |
| L8 | 수정: `Scan` + `BatchWriteItem` 으로 표 전체를 지울 수 있고, 스택 ① 표는 시점 복구(PITR)가 꺼져 있다. 지운 행은 계정 관리자나 배포 작업자가 같은 객체 버전의 적재 이벤트를 다시 넣어야 돌아온다. 기존 필드에 다른 타입 값을 쓰면 색인이 실패해 DLQ 알람이 온다 | `stack1-ingest/template.yaml` `PointInTimeRecoveryEnabled: false`. PITR 켜기는 템플릿 변경이라 범위 밖. 다른 타입 값 → DLQ 는 09-23 실측(독성 레코드), 알람 메일 수신은 SNS 발송 사용량 2건으로만 간접 확인(실측) |
| L9 | 실무자는 자기 키를 재발급하지 못한다 | GuardDeny 병행의 귀결(위). 판정 표의 세 유형 공통 IAM 거부 행(`iam:CreateUser`·`iam:CreateAccessKey`=explicitDeny) |
| L10 | 실무자 그룹에서 `SlsGuardDeny` 가 빠진 것, `<컬렉션>-read` 에 쓰기 권한이나 `staff-` 밖 주체가 들어간 것은 자동으로 못 잡는다. 배포 키의 그룹 조회는 `SelfInspectionOwnGroup` 이 `group/sls-operators` 에 한정하고, 읽기 정책은 스택 밖이다. V8b 는 정책 원문만 대조한다 | 종료 점검 6번에서 사람이 본다 |

남은 `미검증`: 와일드카드 읽기 정책(`collection/sls-*`·`index/sls-*/*`)은 CLI 로는 저장되지만 콘솔 저장과 실제 권한은 `미검증`(지금은 정확한 컬렉션 이름) · 나간 실무자와 같은 이름으로 사용자를 다시 만들면 명단에 남은 ARN 으로 읽기 권한이 되살아나는지 `미검증`(3부는 지우기 전에 빼라고 적는다) · 콘솔에서 `SlsGuardDeny` 를 지울 때 그룹 부착이 자동으로 떼어지는지 `미검증`(어느 쪽이든 지우지 않는다고 적었다).

---

## verify 체크 표

```bash
config/scripts/verify.sh <profile> <12자리 계정 ID> [사용자명, 기본 sls-deployer] [정책 폴더, 기본 config/policies]
```

- 키는 `~/.aws/credentials` 프로파일로만 둔다. 필요: AWS CLI v2, python3. 출력의 계정 ID 는 `<acct>` 로 마스킹하고 키 값은 출력하지 않는다.
- 실행 순서: V1·V2·V2b → V3·V4 시뮬레이션 → V7·V8·V8b·V9·V9b·V9c(전부 읽기 전용) → 반려가 하나라도 있으면 여기서 종료 → **그 다음에야** 쓰기 호출 V5·V6. 반려 키로는 대상 계정에 아무것도 쓰지 않는다. 표는 번호순이라 실행 순서와 다르다.

| # | 확인하는 것 | 통과 기준 | 실패 시 |
|---|---|---|---|
| V1 | 키 주인 | `Arn` 이 정확히 `arn:aws:iam::<기대 계정 ID>:user/sls-deployer` | root·다른 계정·다른 사용자 → **반려, 즉시 종료** |
| V2 | 붙은 정책 | 그룹이 `sls-operators` 하나, 관리형 부착 ARN 이 정확히 `SlsServerlessAllow`+`SlsGuardDeny`, 사용자·그룹 인라인 0 | 그 밖의 어떤 조합도(`ReadOnlyAccess` 추가, 이름만 같은 인라인 포함) → **반려, 즉시 종료** |
| V2b | 다른 자격 증명 | 활성 액세스 키 1개, 콘솔 암호(LoginProfile) 없음(`NoSuchEntity` 만 통과) | 키 2개 이상·암호 있음 → 수정 요청. LoginProfile 조회가 다른 오류면 반려 |
| V3 | 허용 시뮬레이션(V3a~V3d) | a) role 생명주기 10개(`role/sls-probe`, 바운더리·PassedToService·허용 관리형 컨텍스트) b) 서비스 액션 20개(`*`, `AuthType AWS_IAM`·`Principal s3.amazonaws.com` 컨텍스트) b2~b4) 자기 사용자·그룹·계정 조회 c) aoss 서비스 연결 role d) 비용 읽기 — 전부 `allowed`, 판정 줄 수 = 요청 액션 수 | 수정 요청(정책 붙여넣기 누락). d) 가 조직 SCP 로 막혔으면 NOTE |
| V4 | 거부 시뮬레이션(V4a~V4j) | 전부 **`explicitDeny`**: a) 허용 밖 서비스(bedrock·ec2·sagemaker·rds·kms·apigateway·events·organizations·account·billing)·비용 폭탄·노출·Object Lock·공유 31개 a2·a3) `AuthType NONE`·`Principal *`·외부 계정 AddPermission b) `user/probe` c) `policy/probe` c2) OIDC/SAML d) `role/not-sls-role`(d2 는 바운더리·lambda·허용 관리형 컨텍스트를 넣어 경로 Deny 로 막히는지) e) 바운더리 없는 `role/sls-probe` e2) 바운더리 있어도 `UpdateAssumeRolePolicy` f) Admin 관리형 부착 g) PassRole→ec2 h) ec2 서비스 연결 role i) us-east-1 j) 경로 role `role/sls-x/probe` 의 CreateRole·PassRole | `implicitDeny`·`allowed` 하나라도 → **반려, 즉시 종료** |
| V5 | 리전 실호출(쓰기 — 맨 뒤) | us-east-1 버킷 생성 오류에 `explicit deny` | `AccessDenied` 지만 explicit 아님, 또는 생성됨(즉시 삭제) → 수정 요청 |
| V6 | 서울 스모크(쓰기 — 맨 뒤) | 난수 이름 버킷 생성·객체 put/delete·버킷 삭제(`s3api`, `--expected-bucket-owner`), 로그 그룹 `/sls/probe` 생성/삭제, dynamodb·opensearchserverless·lambda·cloudformation 목록 | 수정 요청(허용목록 누락). 직접 만든 것만 지운다. 로그 그룹 삭제 실패는 NOTE |
| V7 | Bedrock 실호출 | 서울 `aws bedrock list-foundation-models` 오류에 `explicit deny`(us-east-1 이면 리전 Deny 가 대신 막아 판정이 안 된다) | **반려** |
| V8 | 정책 원문 diff | 계정의 3개 정책 기본 버전 == 정책 폴더의 JSON(키 정렬 후 비교, 정본은 이 한 벌) | 셋 중 하나라도 다름·조회 불가·원본 없음 → **반려**(Allow 가 넓어진 것도 반려) |
| V8b | 실무자 유형 정책 원문 diff(있을 때만) | 계정에 `SlsStaffPush`·`SlsStaffQuery`·`SlsStaffEdit` 가 있으면 기본 버전 == 정책 폴더의 JSON. 없으면(`NoSuchEntity`) `NOTE V8b` 한 줄이고 PASS·FAIL 에 세지 않는다 — 실무자 유형은 선택 사항이다 | 다름·원본 없음 → 수정 요청(실무자 정책은 배포 키 권한에 닿지 않아 키 재발급이 조치가 아니다. 배포 키 그룹에 붙었다면 V2 가 반려한다). `NoSuchEntity` 가 아닌 조회 오류 → **반려** |
| V9 | 계정 위생 | `AccountMFAEnabled` 1, `AccountAccessKeysPresent` 0, 계정 수준 S3 퍼블릭 액세스 차단 4개 `True` | 수정 요청(계정 관리자 조치, 01 § 3.1·3.7) |
| V9b | `sls-*` role 신뢰 정책 | ARN 에 `:role/sls-` 가 든 모든 role(경로 포함)의 Principal 이 `{"Service":"lambda.amazonaws.com"}` 뿐. 조회 실패는 반려(fail-closed) | 외부 주체 있음 → **반려**(키를 지워도 남는 접근 경로). 재검증 때마다 본다 |
| V9c | 계정에 원래 있던 자원 | a) 모든 `sls-*` role 이 `SlsLambdaBoundary` 를 달고 있다 b) 서울 Lambda 함수가 전부 `sls-*` role 로 돈다 c) `RoleARN` 이 붙은 스택이 없다 | a·b·c → **반려**. 서울 스택 이름이 `sls-*`·`aws-sam-cli-managed-default` 어느 쪽도 아니면 → 수정 요청(전용 계정이 아님, 계정 관리자에게 확인) |

- 종료 코드: 0 = 전부 통과 · **1 = 반려**(V1·V2·V4·V7·V8·V9b·V9c, 그리고 V2·V2b·V8b·V9b·V9c 의 조회 실패) · **2 = 수정 요청**(V2b·V3·V5·V6·V8b·V9, V9c 의 스택 이름) · 64 = 인자 오류.
- 코드 기준 예외: V9 의 조회(`get-account-summary`·`s3control get-public-access-block`)가 실패하면 반려가 아니라 수정 요청으로 떨어진다. 스크립트 머리 주석의 "모든 조회 실패 = 반려"와 다르다.
- 기대 결과: 깨끗한 새 계정에서 **39 PASS · 0 FIX**(PASS 줄 = V1 1 · V2 1 · V2b 2 · V3 7 · V4 15 · V7 1 · V8 3 · V9 2 · V9b 1 · V9c 4 · V5 1 · V6 1). 이전 이름 실측(09-29)은 37 PASS + FIX 2(V2b 활성 키 2개 · V9 루트 MFA 미등록 — 둘 다 계정 상태). 39 는 실무자 유형 정책이 없는 계정 기준이다(그때 `NOTE V8b` 3줄). 실무자 정책 n개가 계정에 있고 원본과 같으면 V8b PASS 가 n줄 더해져 39+n 이다.

시뮬레이션(`iam simulate-principal-policy`, V3·V4)은 손으로 돌리지 않는다. 손으로 돌리면 아래에서 오판한다(실측 09-23).

- 액션의 리소스 타입과 맞지 않는 ARN 을 주면 `implicitDeny` 가 나온다. role ARN 과 `*` 를 한 번에 주면 s3·lambda 가 전부 `implicitDeny`, 거부 검사에서는 bedrock·ec2 가 정책과 무관하게 "denied" 로 보인다. 스크립트는 서비스 액션은 `*`, IAM 액션은 `user/`·`policy/`·`role/` 타입별 ARN 으로 나눠 돌린다.
- 거부는 `explicitDeny` 만 통과다. `implicitDeny` 는 Allow 가 없다는 뜻이라 GuardDeny 문 누락을 못 잡는다.
- 컨텍스트 키: `aws:RequestedRegion`(서울/us-east-1), `iam:PassedToService`(lambda/ec2), `iam:PermissionsBoundary`(있음/없음), `iam:PolicyARN`(Lambda 실행용/Admin), `iam:AWSServiceName`(aoss/ec2), `lambda:FunctionUrlAuthType`, `lambda:Principal`.
- `ce:`·`budgets:` 는 계정이 Organizations 멤버면 SCP 에 막힐 수 있고(실호출 오류에 `service control policy`), 계정 설정 "IAM 사용자 및 역할의 결제 정보에 대한 액세스"(01 § 3.3)가 꺼져 있어도 정책이 맞는데 AccessDenied 가 난다 — 키 정책 문제로 오판하지 않는다.

---

## 정책이 못 막는 비용

아래는 조건 키나 정책 문으로 거를 수 없어 **예산 알림(01 § 3.4 의 `sls-monthly`·`sls-zero-guard`)이 유일한 방어**다.

1. DynamoDB 프로비저닝 용량 크기(큰 고정 용량으로 표 만들기) — 용량 크기에 대한 조건 키가 없다.
2. Lambda 실행 횟수, 메모리 × 타임아웃 × 동시성.

대조: OpenSearch Serverless 용량은 두 겹이다 — 계정 관리자가 거는 계정 단위 최대 OCU(01 § 3.6)와, 키가 그 설정·컬렉션 그룹을 못 건드리게 하는 `DenyCostBombsInsideAllowedServices`.

### 비용 밖에서 못 막는 것

사용 종료 점검(02 § 4 의 3번)에서 본다.

1. `s3:PutBucketPolicy` 로 특정 외부 계정에만 주는 버킷 정책 — SAM 관리 버킷이 이 액션을 쓰므로 거부 불가.
2. aoss 데이터 접근 정책의 principal.
3. SQS·SNS 의 `Set*Attributes`(Policy 속성).
4. 서비스 주체에 `SourceAccount` 없이 주는 `lambda:AddPermission`(confused deputy).
5. 새로 만드는 `sls-*` role 신뢰 정책의 외부 계정 — V9b 로도 본다.

---

## 정책을 바꿀 때

1. [`../config/policies/`](../config/policies/) 의 JSON 을 고친다. V8 이 이 한 벌과 계정 정책을 대조하므로 다른 사본을 두지 않는다.
2. 크기를 확인한다. IAM 관리형 정책 상한은 6,144자(공백 제외). 현재 파일은 Allow 2,193 · GuardDeny 5,311 · Boundary 1,580자(2026-10-02, `tr -d ' \n\t\r' < 파일 | wc -c`). GuardDeny 는 약 830자 남았다 — 문을 더하려면 먼저 합치거나 줄인다.
3. 비용·노출·외부 공유 Deny 를 GuardDeny 에 더하면 `SlsLambdaBoundary` 에도 같은 축으로 미러한다. GuardDeny 는 사용자 키에만 붙어, role 인라인 정책 + Lambda 호출 경로는 바운더리만 막는다.
4. Deny 를 더하면 verify.sh V4 프로브에도 그 액션을 넣는다(지금 V4a 31개). 시뮬레이션에 없는 Deny 는 누락돼도 verify 가 잡지 못한다.
5. `validate-policy` 로 3개 모두 **0 finding** 을 확인한다. 배포 키에는 `access-analyzer` 가 없고(`NotAction` 밖) 정책 생성·버전 생성도 거부이므로, 검증과 적용은 계정 관리자 자격으로 한다.

   ```bash
   for f in config/policies/*.json; do
     aws accessanalyzer validate-policy --policy-type IDENTITY_POLICY \
       --policy-document "file://$f" --query 'findings[].[findingType,issueCode]' --output text
   done   # 아무것도 출력되지 않아야 한다
   ```

   이유: CLI `create-policy-version` 은 액션명을 검증하지 않는다. 존재하지 않는 `budgets:DescribeBudgets` 가 그대로 적용돼 실측(verify.sh 시뮬레이션 포함)까지 통과했고, 콘솔 정책 검증기의 "Invalid Action" 으로야 잡혔다(09-24). `StringEquals` 에 `*` 를 쓴 조건도 콘솔 경고("Wildcard Without Like Operator")가 났고, 고친 뒤 `validate-policy` 0 finding 이 됐다(09-24). 3개 0 finding 은 09-29 에도 실측했다.
6. 계정 관리자가 정책 새 버전을 기본 버전으로 적용한 뒤, 배포 작업자가 `verify.sh` 를 다시 돌린다. 깨끗한 새 계정이면 39 PASS · 0 FIX.
7. 거부돼야 할 호출을 실제로 쳐 보는 음성 확인은 **적용 3분 뒤**에 한다. IAM 전파 지연으로 적용 직후 실호출은 통과할 수 있다(88초 뒤 통과 · 3분 뒤 거부 실측).

### 지금 정책으로는 안 되는 것 — 넣으려면

| 필요 | 바꿀 것 |
|---|---|
| 관리형 OpenSearch 도메인 | `es:*` 추가(현재 Serverless `aoss:*` 만) |
| HTTP API(API Gateway) | `apigateway:*` + PassRole 조건에 `apigateway.amazonaws.com`. 간단한 진입점은 지금도 Lambda Function URL(SAM `FunctionUrlConfig`, `AuthType: AWS_IAM`)로 `lambda:*` 안에서 된다 |
| 일정 실행(EventBridge Rules) | `events:*` 를 `events:PutPermission` 을 뺀 채로 넣는다. EventBridge Scheduler(`scheduler:*`)는 별도 서비스이고 PassRole 대상도 `scheduler.amazonaws.com` 이 필요해 쓰지 않는다 |
| aoss VPC 네트워크 정책 | VPC 엔드포인트 생성에 `ec2:CreateVpcEndpoint`·`ec2:Describe*` 가 필요한데 `ec2:*` 는 Deny 다. 지금은 public 네트워크 + 데이터 접근 정책(IAM principal) |
| SSE-KMS | `kms:*` 가 필요하다. 지금은 S3 SSE-S3(AES256), aoss 암호화 정책은 AWS 소유 키라 KMS 를 고르지 않는다 |
