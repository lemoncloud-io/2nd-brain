---
name: aws-iam-access
description: >
  AWS 계정에서 배포 전용 제한 키(배포 키 — IAM 사용자 `sls-deployer` + Access Key)를 발급하고, 그 키가
  허용목록 정책 3개(Allow·GuardDeny·Boundary)만 붙은 키인지 `verify.sh` 로 검증하고, 사용이 끝나면 키와
  자원을 정리하는 절차. 사용자가 "배포 키 발급해줘", "키 제대로 됐는지 확인해줘", "이 키로 되는 게 뭐야",
  "정책 고쳐서 다시 적용", "다 썼으니 키 정리해줘"처럼 요청할 때, 또는 배포 대상 계정의 IAM·
  정책·권한 경계·종료 점검이 화제에 오르면 사용한다. Admin·PowerUser 키는 배포 키로 절대 쓰지 않는다 — 검증에서
  반려한다. SSO·역할 전환(AssumeRole)·조직(Organizations) 구성은 다루지 않는다.
---

# AWS IAM Access (배포 키 발급 · 검증)

배포 대상 계정에 **정책 3개 → 그룹 1개(정책 2개 연결) → 사용자 1개 → Access Key 1개** 를 만들고, 그 키를 배포 작업자 환경의
AWS CLI 프로파일(`sls-deployer`)로만 쓴다. 정책은 파이프라인에 필요한 서비스만 허용하고(허용목록), 그 밖의 모든 서비스·계정 변경·권한 확장은
명시 거부하며, 키가 만드는 Lambda role 에는 권한 경계(permissions boundary)를 강제한다. Bedrock·EC2·SageMaker 가 열린 키는 사고 경로다.
**이 키는 새로 만든 전용 계정에만** — 기존 운영 계정에 붙이면 허용목록 서비스의 기존 자원까지 폭발 반경이다.

## 정책 파일 (정본 = `../policies/`, 한 벌뿐)

| 파일 | 역할 | 요지 |
|---|---|---|
| `SlsServerlessAllow.json` | 허용목록 (키에 부착) | `s3 lambda dynamodb aoss logs cloudwatch sqs sns cloudformation` 전부 · Lambda role 은 `role/sls-*` 이면서 `SlsLambdaBoundary` 를 단 것만 생성·수정 · `iam:PassRole` 은 `lambda.amazonaws.com` 에만 · OpenSearch Serverless 서비스 연결 role 1개 · 자기 자신 조회 · 비용 읽기 |
| `SlsGuardDeny.json` | 명시 거부 (키에 부착) | 허용목록 밖 **모든** 서비스(`NotAction`) / 조직·계정·결제 변경 / 사용자·키·정책 생성 등 권한 확장 / 바운더리 없는 role 쓰기·인라인 정책 / Lambda 실행용 4개 밖 관리형 정책 부착 / 비용 폭탄(aoss 용량 상한·프로비저닝 동시성·글로벌 테이블) / 공개 노출(퍼블릭 차단 해제·`AuthType NONE`·`Principal *`) / 외부 계정 공유(DynamoDB 리소스 정책·SQS/SNS AddPermission·로그 리소스 정책·aoss 보안 설정·S3 ACL·접근점·로깅·복제, v5) / 신뢰 정책 교체·경로 붙은 role(v5) / 서울 밖 리전 |
| `SlsLambdaBoundary.json` | 권한 경계 (role 에 부착) | 허용목록 중 Lambda 가 쓸 서비스(`s3 dynamodb aoss logs sqs sns cloudwatch` — `lambda`·`cloudformation` 없음) + X-Ray 쓰기, 여기에 GuardDeny 의 비용·노출 Deny 복제 + 버킷 정책/ACL 쓰기 Deny + 외부 공유 Deny 미러(v5). SAM `Globals.Function.PermissionsBoundary` 가 붙인다 |

현재 **v5 초안 — 실계정 재실측 대기**(2026-09-29 리뷰 반영 — `UpdateAssumeRolePolicy` 명시 거부, 경로 붙은 role Deny, DynamoDB·SQS·SNS·logs·aoss·S3 외부 공유 액션 Deny, 예약 용량 구매 Deny, verify.sh V9c). 실측 통과본은 **v4**(2026-09-24 2차 리뷰 반영 — 바운더리에 Deny 복제, `sls-*` 밖 role·lambda 밖 PassRole 명시 Deny, `lambda:AddPermission` 서비스 주체 허용목록, Object Lock·OIDC/SAML Deny, 자기 조회 리소스 한정. 09-24 실측 통과). v5 는 validate-policy·verify 39 PASS·stack1/2 새 계정 배포·배포 후 verify 를 통과하기 전에는 실측 통과본으로 확정하지 않는다. v3 는 09-23 실측 통과본이지만 Lambda 경유 `aoss:UpdateAccountSettings` 경로가 열려 있었다. v2 는 인라인 `*` 우회, v1 은 OpenSearch Serverless 첫 컬렉션 생성에서 롤백 — 반드시 최신본을 쓴다. 정책 설계 근거는 `../../guides/policy-design.md`.
바꿀 일이 생기면 JSON 을 고치고 `aws iam create-policy-version --set-as-default` 로 올린 뒤 아래 검증을 다시 돈다.

## 절차 A — 배포 키 발급 (계정 관리자가 콘솔에서, 15~20분)

사람이 따라 하는 화면 안내는 `../../guides/02-restricted-key.md`(2부), 붙여넣을 정책 JSON 3개는 `../policies/`. 요지 (Claude 가 옆에서 같이 볼 때 이 순서로):

1. **IAM → 정책 → 정책 생성 → JSON 탭** → 기본 내용 지우고 `SlsServerlessAllow.json` 붙여넣기 → 이름 동일하게 → 생성. `SlsGuardDeny.json`·`SlsLambdaBoundary.json` 도 같게. 문(Statement) 개수 **10·15·5** 확인 — 눈대중용이고, 정본 대조는 검증 V8 이 JSON 전문으로 한다.
2. **사용자 그룹 → 그룹 생성** `sls-operators` → Allow·GuardDeny **둘만** 체크(Boundary 는 붙이지 않는다).
3. **사용자 → 사용자 생성** `sls-deployer` → **콘솔 액세스는 체크하지 않음**(CLI 전용) → 그룹 `sls-operators` 추가. 직접 부착·인라인 정책 없이.
4. 사용자 → **보안 자격 증명 → 액세스 키 만들기 → CLI** → 설명 태그 → 두 값 복사. **12자리 계정 ID**(검증 인자)와 관리자 사용자 **ARN**(스택 ② `QueryPrincipalArns`)도 적어 둔다.
5. **배포 작업자 환경에 프로파일로 등록한다** — 배포 작업자 PC 에서 `aws configure --profile sls-deployer` 로 직접 입력한다(절차 B 첫 줄). 두 값을 메일 본문·메신저·에이전트 대화창에 붙여넣지 않는다 — 에이전트에게는 프로파일 이름만 알려 준다. 배포 작업자가 다른 사람이면 비밀번호 관리자 공유 링크, 암호 zip + 다른 채널로 암호, 또는 구두.
6. 사용 종료 시 할 일은 § 사용 종료·정리.

절차는 `aws-account-setup.md § 가입 직후 7가지` 5번에서 만든 관리자 IAM 사용자로 한다 — root 로 하지 않는다.
키가 새어 나갔다고 의심되면(메일·대화창에 붙여넣음·화면 공유 중 노출) 계정 관리자가 IAM → 사용자 → 보안 자격 증명 → 그 키 **비활성화** 후 새로 발급하고, 배포 작업자 환경의 프로파일을 새 키로 다시 등록한다.

## 절차 B — 배포 키 검증 (배포 작업자 환경, 5분)

전제: AWS CLI v2, `python3`. 이 계정의 **첫 실키**면 FAIL 이 정책 JSON 자체의 오탈자일 수도 있다 — V8 까지 돌았으면(V1·V2·V4 에서 끊기지 않았으면) V8 결과부터 본다.

```bash
aws configure --profile sls-deployer                    # 키 두 값 · region ap-northeast-2 · output json
aws sts get-caller-identity --profile sls-deployer      # 먼저 — 프로파일 오타·키 복사 실수는 여기서 걸린다
# 볼트 루트에서. 네 번째 인자(정책 폴더)를 생략하면 스크립트 옆 ../policies(= config/policies)를 쓴다
projects/aws-serverless/config/scripts/verify.sh sls-deployer <12자리 계정ID> sls-deployer; echo "exit=$?"
```

| # | 검사 | 통과 | 실패 시 |
|---|---|---|---|
| V1 | 키 주인 | `arn:aws:iam::<기대 계정ID>:user/sls-deployer` 정확히 | `:root`·다른 계정·다른 사용자 → **반려, 즉시 종료**. `자격 증명 오류` 면 키가 아니라 배포 작업자 쪽(프로파일·네트워크) — 위 `sts` 로 먼저 확인 |
| V2 | 붙은 정책 | 그룹 `sls-operators` 하나, 관리형 ARN 정확히 Allow+GuardDeny, 인라인 0 | 그 밖의 조합 전부 → **반려, 즉시 종료** |
| V2b | 같은 사용자의 다른 자격 증명 | 활성 키 1개, 콘솔 암호 없음 | 수정 요청. 조회 자체가 실패하면 반려 |
| V3a~d | 허용 시뮬레이션 | IAM(role/sls-*, 바운더리 컨텍스트)·서비스(`*`)·aoss 서비스 연결 role·비용(V3d) 전부 `allowed` | 막힌 액션 확인 — 대개 정책 붙여넣기 누락. V3d 만 실패면 계정 설정 "IAM 결제 액세스" 꺼짐(`aws-account-setup` 3번) — V3d 는 시뮬레이션이라 Cost Explorer 활성화와는 무관하다 |
| V4a~j | 거부 시뮬레이션 | 서비스(`*`)·user·policy·role 타입별로 나눠 **전부 `explicitDeny`** — 바운더리 없는 CreateRole/PutRolePolicy, Admin 관리형 부착, PassRole→ec2, ec2 서비스 연결 role, us-east-1 포함. V4a 는 31개 액션(v5 에서 외부 공유·예약 용량 7개, 이어서 컬렉션 그룹 2개 추가), V4e2(`sls-*` role 이라도 `iam:UpdateAssumeRolePolicy` 거부)·V4j(경로 붙은 `role/sls-x/probe` 의 CreateRole·PassRole 거부)는 v5 신설 | `implicitDeny` 나 `allowed` 하나라도 → **반려**(V4 전체를 돈 뒤 종료) |
| V5 | 리전 실호출 (쓰기 — 맨 뒤) | us-east-1 버킷 생성이 `explicit deny` | 리전 Deny 누락 |
| V6 | 서울 스모크 (쓰기 — 맨 뒤) | s3·logs·dynamodb·opensearchserverless·lambda·cloudformation 호출 성공 | 허용목록 누락 |
| V7 | Bedrock 실호출 (**서울**) | `explicit deny` | **반려** |
| V8 | 정책 원문 대조 (3개) | 계정의 정책 JSON == `../policies/` | 하나라도 다름·원본 없음 → **반려** |
| V9 | 계정 위생 | root MFA 1 · root 키 0 · 계정 수준 S3 퍼블릭 액세스 차단 4개 켜짐 | 수정 요청 — 계정 관리자 조치 |
| V9b | `sls-*` role 신뢰 정책 | ARN 에 `:role/sls-` 가 든 role(경로 포함)의 신뢰 주체가 `lambda.amazonaws.com` 뿐. 조회 실패는 반려 | 다른 주체 있으면 **반려** — 키를 지워도 남는 외부 접근 경로 |
| V9c | 계정에 원래 있던 자원 (v5) | `sls-*` role 전부 `SlsLambdaBoundary` · 서울 Lambda 함수 전부 `sls-*` role · `RoleARN` 이 붙은 스택 없음 | **반려** — PassRole 은 바운더리 조건을 못 걸어 기존 role·함수·스택으로 남의 권한을 빌린다. 스택 이름이 `sls-*`·`aws-sam-cli-managed-default` 밖이면 수정 요청(전용 계정 아님) |

종료 코드와 다음 할 일:

| exit | 뜻 | 계정 관리자가 할 일 | 배포 작업자가 할 일 |
|---|---|---|---|
| 0 | 통과 | — | 결과 한 줄을 작업 노트에 남긴다. 배포 시작 |
| 1 | 반려(V1·V2·V4·V7·V8·V9b·V9c). 단 FAIL 줄이 `자격 증명 오류`·`조회 실패` 면 키 판정 전에 끊긴 것 — 배포 작업자 쪽(프로파일·네트워크)부터 확인하고 재실행 | 그 키 **삭제** → 정책 재적용(2부 § 2.1~2.2) → 새 키 발급. 사용자당 키는 2개까지라 옛 키를 먼저 지운다 | 그 키를 `~/.aws` 에서 지운다. 그 키로 아무것도 하지 않는다 |
| 2 | 수정 요청(V2b·V3·V5·V6·V9, V9c 스택 이름) | FAIL 줄의 항목만 고친다 — 키 재발급 없음 | 고친 뒤 **전체** 재실행(부분 실행 없음). exit 0 전에는 배포하지 않는다 |
| 64 | 인자 오류(계정 ID 12자리 아님·정책 폴더 없음) | — | 명령을 고친다 |

- 출력의 `NOTE` 줄은 종료 코드에 안 들어간다: V3d SCP, V5 의 us-east-1 버킷 삭제 실패(V5 FAIL 과 같이 나온다 — 그 버킷을 지운다). V6 임시 버킷 삭제 실패는 NOTE 가 아니라 V6 FAIL(exit 2)이다.
- V5·V6 은 통과 키로 대상 계정에 임시 버킷(`sls-probe-*`)·로그 그룹(`/sls/probe`)을 만들었다 지운다. **순서 보장(v5)**: 읽기 전용 판정(V1·V2·V2b → V3·V4 → V7·V8·V9·V9b·V9c)을 전부 끝내고 반려가 있으면 그 자리에서 종료한 뒤에야 쓰기(V5·V6)를 돈다 — 반려 키(root·Admin·남의 role 을 빌릴 수 있는 계정)로 대상 계정에 아무것도 쓰지 않는다. 깨끗한 새 계정의 기대 결과는 **39 PASS · 0 FIX**(v5 — 09-29 실측 계정은 37 PASS + FIX 2, 둘 다 계정 상태(실측). v4 실측은 31 PASS).
- `~/.aws/credentials` 밖에 키를 적지 않는다. 로그·문서의 계정 ID 는 `<acct>` 로 마스킹한다(스크립트가 한다).

### 판정할 때 알아야 할 것 (실측)

- `simulate-principal-policy` 는 액션과 리소스 타입이 안 맞으면 `implicitDeny` 를 돌려준다 — IAM role 액션은 role ARN 으로, 서비스 액션은 `*` 로 **나눠** 돌린다. 스크립트가 이미 그렇게 한다.
- `ce:`·`budgets:` 가 `explicit deny in a service control policy` 면 키 정책 문제가 아니라 계정이 AWS Organizations 멤버라서다. 단독 계정에선 안 나온다. 계정 설정 "IAM 사용자 및 역할의 결제 정보에 대한 액세스" 가 꺼져 있어도 막힌다 — `aws-account-setup`.
- CLI 서비스명은 `aws opensearchserverless`(IAM 접두는 `aoss:`).
- V4 는 `explicitDeny` 만 통과다(V4d2 포함 — v3 에서는 `implicitDeny` 도 허용했으나 v4 부터 명시 거부 필수). `implicitDeny` 는 GuardDeny 가 막은 게 아니라 Allow 가 없을 뿐이라, GuardDeny 문 누락을 못 잡는다.
- GuardDeny 의 `NotAction` 은 KMS 데이터 액션 5개를 예외로 둔다 — 없으면 Lambda 환경 변수 암호화(`aws/lambda` 관리형 키)에서 `kms:Encrypt explicit deny` 로 롤백(09-23 실측).
- V7 은 서울로 친다. us-east-1 로 치면 리전 Deny 가 먼저 막아 Bedrock 문 누락을 못 잡는다.
- Admin 키는 V2 에서 즉시 종료된다. 스크립트 자체의 음성 대조(Admin 키로 V4 가 allowed 로 나오는지)는 `../../guides/policy-design.md` § verify 체크 표의 "시뮬레이션은 손으로 돌리지 않는다" 의 예외다 — 검증이 아니라 스크립트 테스트이므로 `sim()` 과 같은 인자로 `simulate-principal-policy` 를 따로 돌린다(실측).

## 이 키로 되는 것 / 안 되는 것 (계정 관리자 질문에 답할 때)

- 된다: 서울 리전에서 S3·Lambda·DynamoDB·OpenSearch Serverless·SQS·SNS·CloudWatch·CloudFormation 생성/삭제, `sls-` 로 시작하고 바운더리를 단 Lambda 실행 role 만들기, 비용 조회.
- 안 된다: 다른 리전, EC2·RDS·Bedrock 등 허용목록 밖 전부, 사용자·키·정책 만들기(자기 권한 확장), role 에 허용목록 밖 권한 붙이기, 결제·계정 설정 변경, 다른 role 로 전환, KMS, API Gateway, EventBridge, VPC, 인증 없는 Function URL, aoss 용량 상한 변경, role 신뢰 대상 바꾸기·경로 붙은 role, 표·대기열·주제·로그·S3 를 다른 계정에 공유(ACL·접근점·로깅·복제 포함), DynamoDB 예약 용량 구매. (특정 외부 계정에만 주는 S3 버킷 정책은 SAM 이 써서 못 막는다 — 종료 점검에서 본다.)
- API Gateway·EventBridge 가 필요해지면 다음 정책 버전(v6)에서 연다 — 그 전까지 HTTP 진입점은 Lambda Function URL(`AuthType: AWS_IAM`, `lambda:*` 안).

## 사용 종료·정리 (배포 작업자 + 계정 관리자 — 마지막 날 30분 · 철거 이틀 뒤 청구 확인 · 일주일 뒤 키 삭제)

키를 지우는 것만으로는 끝나지 않는다 — 키가 만든 자원과 접근 경로가 남는다. 순서가 중요하다: 자원을 먼저 정리해야
키가 아직 살아 있을 때 철거 명령이 먹고, 남긴 자원 확인은 관리자 사용자로 해야 배포 키 없이도 운영되는지가 검증된다.
프로파일 두 개를 구분한다: `sls-deployer` = 배포 키, `<admin-profile>` = 계정 관리자(`admin-<이름>`) 키 또는 그 사용자의 콘솔 로그인(CloudShell). 관리자 키를 배포 작업자 환경에 두지 않아도 되면 콘솔로 한다.

1. **스택마다 남길지 정한다.** 고정비는 스택 ②(OpenSearch)뿐이다.

   | 스택 ① (S3·DynamoDB) | 스택 ② (OpenSearch) | 언제 |
   |---|---|---|
   | 철거 | 철거 | 사용 종료 |
   | 남김 | 철거 | 데이터는 계속 모으되 검색은 아직 — **OpenSearch 를 계속 쓸지 미정이면 이것**(② 는 테이블에서 언제든 재색인으로 복구) |
   | 남김 | 남김 | 계속 운영 — 월 고정비(`aws-opensearch.md § 비용`)를 계정 관리자가 승인했을 때만 |

   ① 만 지우고 ② 를 남기는 조합은 없다 — ② 가 ① 의 스트림을 읽는다.
2. **철거 — ② → ① 순서.** `aws-opensearch.md § 철거` → (① 도 지우면) `aws-s3-ingest.md § 철거`(버킷 비우기 포함).
   둘 다 지웠고 다시 배포할 일이 없으면 SAM 배포 버킷 스택도: `aws cloudformation delete-stack --stack-name aws-sam-cli-managed-default --profile sls-deployer --region ap-northeast-2` (버킷에 객체가 있으면 먼저 비운다 — `aws-s3-ingest.md § 철거` 의 버전 비우기와 같다).
3. **마지막 청구 확인 — 스택 ② 를 지웠으면 반드시.** Cost Explorer 는 하루 늦고 `End` 는 그날을 빼므로 철거일 D 의 **이틀 뒤**에 배포 키로(그래서 키는 이 단계 뒤에 끈다):
   ```bash
   aws ce get-cost-and-usage --profile sls-deployer --time-period Start=<D>,End=<D+2> --granularity DAILY \
     --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE --filter '{"Dimensions":{"Key":"RECORD_TYPE","Values":["Usage"]}}'
   ```
   D+1 날짜의 OpenSearch 가 들어간 SERVICE 줄 금액이 0 이면 멈춘 것(삭제 후 과금이 몇 분 안에 멈추는지는 `미검증`). 결과를 정리 기록에 적는다. `ce:` 는 요청당 USD 0.01.
4. **계정 관리자로 접근 확인** — 남기는 스택이 있을 때. `admin-<이름>` 콘솔 로그인으로 S3 버킷·DynamoDB 테이블·CloudWatch 알람, (② 를 남겼으면) OpenSearch 대시보드(`QueryPrincipalArns` 에 든 사용자만 열린다)가 보이는지.
   알람 메일 수신자가 앞으로 운영할 사람의 메일인지 — 아니면 `samconfig.<project>.toml` 의 `AlarmEmail` 을 바꿔 재배포하고 새 수신자가 구독 확인 메일을 누른다.
5. **키 비활성화 → 일주일 뒤 삭제** (계정 관리자, 콘솔 IAM → 사용자 `sls-deployer` → 보안 자격 증명, 또는):
   ```bash
   aws iam list-access-keys --user-name sls-deployer --profile <admin-profile>
   aws iam update-access-key --user-name sls-deployer --access-key-id <AKIA...> --status Inactive --profile <admin-profile>
   aws iam delete-access-key --user-name sls-deployer --access-key-id <AKIA...> --profile <admin-profile>    # 일주일 뒤
   ```
   그 사이 "안 되는 게 생겼다" 면 다시 켜서 원인을 본다. 배포 작업자 환경의 `~/.aws` 에서도 `sls-deployer` 프로파일을 지운다.
   정책 3개·그룹·사용자는 남겨도 무해하고 다음 사용 때 재사용한다. 특히 `SlsLambdaBoundary` 는 지우지 않는다 — 남긴 스택을 재배포할 때 role 이 이 바운더리를 요구한다.
6. **종료 점검(외부 접근 경로 0건)** — 관리자로. 이 계정(`<acct>`) 밖 주체가 하나라도 있으면 계정 관리자가 지운다:
   ```bash
   export AWS_PROFILE=<admin-profile> AWS_REGION=ap-northeast-2   # CloudShell 이면 이 줄 없이
   for r in $(aws iam list-roles --query "Roles[?contains(Arn,':role/sls-')].RoleName" --output text); do   # 경로 붙은 role 까지 ARN 기준(v5)
     aws iam get-role --role-name $r --query '[Role.AssumeRolePolicyDocument.Statement[].Principal, Role.PermissionsBoundary.PermissionsBoundaryArn]' --output json; done   # lambda.amazonaws.com 만 · 바운더리 SlsLambdaBoundary (V9b·V9c 와 같은 조건 — 관리자 권한으로 verify.sh 읽기 전용 부분을 다시 돌려도 된다)
   aws s3api get-bucket-policy --bucket <BucketName>                      # NoSuchBucketPolicy 가 정상 — 특정 외부 계정에만 주는 버킷 정책은 키 정책으로 못 막으므로(v5 알려진 한계) 여기서 본다
   aws lambda get-policy --function-name <IngestFunctionName>             # s3.amazonaws.com + 이 계정 버킷만
   aws sqs get-queue-attributes --queue-url <DlqUrl> --attribute-names Policy
   aws opensearchserverless list-access-policies --type data             # ② 를 남겼으면: 주체가 admin·함수 role 뿐인지 get-access-policy 로
   ```
   예산 알림 수신자에서 배포 작업자 메일을 뺄지는 계정 관리자가 정한다.
7. **정리 기록 한 장** — 남긴 스택의 Outputs(버킷·테이블·컬렉션 엔드포인트·대시보드 URL), 알람 메일, 3번 청구 확인 결과, 비용 보는 법(Budgets·Cost Explorer),
   다시 켜는 법(② 를 지웠다면: 스택 ② 재배포 → `aws-opensearch.md § 재색인` 으로 테이블에서 전부 복구), SAM 소스 사본 — 계정 관리자가 이 볼트를 쓰지 않으면 같이 넘긴다. 프로젝트별 설정 파일(`aws-lambda-deploy.md § 프로젝트별 설정 파일`)은 재배포 값(`TableStreamArn`·`QueryPrincipalArns`·메일)을 담고 있어 **넣는다**(이 계정의 값이다):
   ```bash
   D=$(mktemp -d); cp -R ../sam/stack1-ingest ../sam/stack2-index "$D"/
   find "$D" \( -name node_modules -o -name .aws-sam \) -prune -exec rm -rf {} +
   find "$D" -name 'samconfig.*.toml' ! -name 'samconfig.<project>.toml' -delete     # 다른 프로젝트 파일 제외
   (cd "$D" && zip -qr ~/Desktop/<project>-sls-sam.zip .)
   ```
