#!/usr/bin/env bash
# verify.sh — 받은 배포 키(AWS)가 SlsServerlessAllow + SlsGuardDeny 만 붙은
# 제한 키인지 판정한다 (guides/policy-design.md § verify 체크 표 V1~V9c, 정책 v5 기준).
#
# 사용: ./verify.sh <profile> <expected-account-id> [expected-user-name] [policies-dir]
#   profile             ~/.aws/credentials 의 프로파일 이름 (키는 여기에만 둔다)
#   expected-account-id 대상 계정의 12자리 계정 ID (01 § 3.5 콘솔 로그인 URL 의 숫자)
#   expected-user-name  기본 sls-deployer (02 § 2.3 의 사용자명)
#   policies-dir        V8 diff 용 원본 JSON 폴더, 기본 <이 스크립트>/../policies (정본은 이 한 벌뿐)
#
# 종료 코드: 0 = 전부 통과, 1 = 반려(V1·V2·V4·V7·V8·V9b·V9c, 그리고 모든 조회 실패),
#           2 = 수정 요청(V2b·V3·V5·V6·V9·V9c 스택 이름), 64 = 인자 오류.
# 조회 자체가 실패하면(프로파일 오타·네트워크·CLI 없음 포함) 라벨과 무관하게 반려로 끝난다 — 먼저 `aws sts get-caller-identity --profile <p>` 로 확인.
# 필요: AWS CLI v2, python3. V5·V6 은 대상 계정에 임시 버킷·로그 그룹을 만들었다 지운다(V5 버킷 삭제 실패는 NOTE, V6 삭제 실패는 V6 FAIL).
# 순서: 읽기 전용 판정(V1·V2·V2b → V3·V4 시뮬레이션 → V7·V8·V9·V9b·V9c)을 먼저 끝내고, 반려가 나오면
# 그 단계에서 끝낸다. 쓰기 호출(V5 us-east-1 버킷 생성 시도, V6 서울 스모크)은 반려 0 일 때만 맨 뒤에서 돈다
# — 반려 키로는 대상 계정에 아무것도 쓰지 않는다.
# 출력의 계정 ID 는 <acct> 로 마스킹한다. 키 값은 절대 출력하지 않는다.

set -u -f   # -f: sim() 의 리소스 "*" 가 파일 글롭으로 풀리지 않게
# ${1:?} 는 인자 오류를 64 가 아니라 1(반려와 같은 값)로 끝내므로 먼저 개수를 본다
[[ $# -ge 2 ]] || { echo "사용: $0 <profile> <expected-account-id> [expected-user-name] [policies-dir]"; exit 64; }
PROFILE="${1:?profile}"
EXPECT_ACCT="${2:?expected-account-id (12 digits)}"
EXPECT_USER="${3:-sls-deployer}"
POLDIR="${4:-$(dirname "$0")/../policies}"
[[ "$EXPECT_ACCT" =~ ^[0-9]{12}$ ]] || { echo "expected-account-id 는 12자리 숫자여야 한다"; exit 64; }
[[ -d "$POLDIR" ]] || { echo "정책 원본 폴더 없음: $POLDIR"; exit 64; }
export AWS_PROFILE="$PROFILE"
export AWS_PAGER=""
REGION=ap-northeast-2
POLICIES=(SlsServerlessAllow SlsGuardDeny SlsLambdaBoundary)
GROUP=sls-operators
PROBE_FILE="${TMPDIR:-/tmp}/sls-probe.$$.txt"
trap 'rm -f "$PROBE_FILE"' EXIT

REJECT=0; FIX=0
pass() { printf '  PASS %s — %s\n' "$1" "$2"; }
fail() { printf '  FAIL %s — %s\n' "$1" "$2"; }
reject() { fail "$1" "$2"; REJECT=1; }
fix()    { fail "$1" "$2"; FIX=1; }
mask() { sed -E 's/[0-9]{12}/<acct>/g'; }
bail() { echo "== result: REJECT (여기서 중단 — 반려 키로는 아무것도 실행하지 않는다) =="; exit 1; }
# 조회 호출이 실패하면(권한·스로틀) 빈 결과를 "없음" 으로 읽지 않는다 — 실패는 반려.
run() { # $1 label, rest = aws 인자. 결과는 전역 OUT (서브셸이 아니어야 reject·bail 이 스크립트를 끝낸다)
  local label="$1"; shift
  OUT=$(aws "$@" 2>&1) || { reject "$label" "조회 실패($1 $2): $(echo "$OUT" | head -1 | mask)"; bail; }
}

echo "== verify profile=$PROFILE expect <acct>:user/$EXPECT_USER =="

# ---------- V1 키 주인 (계정 + 사용자) ----------
ME=$(aws sts get-caller-identity --query Arn --output text 2>&1)
ACCT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)
echo "V1 caller: $(echo "$ME" | mask)"
case "$ME" in
  *:root)                       reject V1 "root 키 — 즉시 반려" ;;
  "arn:aws:iam::$EXPECT_ACCT:user/$EXPECT_USER") pass V1 "<acct>:user/$EXPECT_USER" ;;
  arn:aws:iam::*)               reject V1 "예상 계정/사용자 아님 ($(echo "$ME" | mask))" ;;
  *)                            reject V1 "자격 증명 오류: $(echo "$ME" | head -1 | mask)" ;;
esac
[[ $REJECT == 1 ]] && bail
USER_NAME="${ME##*/}"

# ---------- V2 붙은 정책 (ARN 기준 · 인라인 0 · 그룹 1) ----------
EXPECT_ARNS=$(printf 'arn:aws:iam::%s:policy/SlsGuardDeny\narn:aws:iam::%s:policy/SlsServerlessAllow\n' "$ACCT" "$ACCT")
run V2 iam list-groups-for-user --user-name "$USER_NAME" --query 'Groups[].GroupName' --output text
GROUPS_=$(echo "$OUT" | tr '\t' '\n' | grep -v '^$')
ARNS=""; INLINE=""
for g in $GROUPS_; do
  run V2 iam list-attached-group-policies --group-name "$g" --query 'AttachedPolicies[].PolicyArn' --output text; ARNS+="$(echo "$OUT" | tr '\t' '\n')"$'\n'
  run V2 iam list-group-policies --group-name "$g" --query 'PolicyNames' --output text; INLINE+="$(echo "$OUT" | tr '\t' '\n')"$'\n'
done
run V2 iam list-attached-user-policies --user-name "$USER_NAME" --query 'AttachedPolicies[].PolicyArn' --output text; ARNS+="$(echo "$OUT" | tr '\t' '\n')"$'\n'
run V2 iam list-user-policies --user-name "$USER_NAME" --query 'PolicyNames' --output text; INLINE+="$(echo "$OUT" | tr '\t' '\n')"$'\n'
ARNS=$(echo "$ARNS" | grep -v '^None$' | grep -v '^$' | sort -u)
INLINE=$(echo "$INLINE" | grep -v '^None$' | grep -v '^$' | sort -u)
echo "V2 groups: $(echo $GROUPS_) / managed: $(echo "$ARNS" | mask | tr '\n' ' ')/ inline: ${INLINE:-<none>}"
if [[ -z "$ARNS" ]]; then reject V2 "정책 없음"
elif [[ -n "$INLINE" ]]; then reject V2 "인라인 정책이 붙어 있음: $(echo $INLINE) — 관리형 2개 외에는 반려"
elif [[ "$ARNS" != "$EXPECT_ARNS" ]]; then reject V2 "정책 조합이 정확히 SlsServerlessAllow+SlsGuardDeny 가 아님"
elif [[ "$(echo $GROUPS_)" != "$GROUP" ]]; then reject V2 "그룹이 정확히 $GROUP 하나가 아님: $(echo $GROUPS_)"
else pass V2 "그룹 $GROUP 에 관리형 2개만, 인라인 0"; fi
[[ $REJECT == 1 ]] && bail

# V2b 같은 사용자의 다른 자격 증명 — 두 번째 키·콘솔 암호는 수정 요청
run V2b iam list-access-keys --user-name "$USER_NAME" --query 'AccessKeyMetadata[?Status==`Active`].AccessKeyId' --output text
KEYS=$(echo "$OUT" | wc -w | tr -d ' ')
[[ "$KEYS" == "1" ]] && pass V2b "활성 액세스 키 1개" || fix V2b "활성 액세스 키 ${KEYS}개 — 이 키 외에는 삭제 요청"
OUT=$(aws iam get-login-profile --user-name "$USER_NAME" 2>&1)
if [[ $? -eq 0 ]]; then fix V2b "콘솔 암호(LoginProfile) 있음 — CLI 전용이어야 함"
elif echo "$OUT" | grep -q NoSuchEntity; then pass V2b "콘솔 암호 없음"
else reject V2b "LoginProfile 조회 실패: $(echo "$OUT" | head -1 | mask)"; bail; fi

# ---------- V3 / V4 시뮬레이션 ----------
sim() { # $1 = resource arns (space sep), $2 = context entries (space sep, may be empty), rest = actions
  local res="$1" ctx="$2"; shift 2
  # shellcheck disable=SC2086
  aws iam simulate-principal-policy --policy-source-arn "$ME" --action-names "$@" \
    --resource-arns $res ${ctx:+--context-entries $ctx} \
    --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text 2>&1
}
ctx() { printf 'ContextKeyName=%s,ContextKeyValues=%s,ContextKeyType=string' "$1" "$2"; }
CTX_SEOUL=$(ctx aws:RequestedRegion $REGION)
CTX_US=$(ctx aws:RequestedRegion us-east-1)
CTX_LAMBDA=$(ctx iam:PassedToService lambda.amazonaws.com)
CTX_EC2=$(ctx iam:PassedToService ec2.amazonaws.com)
CTX_BOUNDARY=$(ctx iam:PermissionsBoundary "arn:aws:iam::${ACCT}:policy/SlsLambdaBoundary")
CTX_SLR_AOSS=$(ctx iam:AWSServiceName observability.aoss.amazonaws.com)
CTX_SLR_EC2=$(ctx iam:AWSServiceName ec2.amazonaws.com)
CTX_POLICY_OK=$(ctx iam:PolicyARN arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole)
CTX_POLICY_ADMIN=$(ctx iam:PolicyARN arn:aws:iam::aws:policy/AdministratorAccess)
CTX_URL_NONE=$(ctx lambda:FunctionUrlAuthType NONE)
CTX_URL_IAM=$(ctx lambda:FunctionUrlAuthType AWS_IAM)
CTX_PRINCIPAL_S3=$(ctx lambda:Principal s3.amazonaws.com)
CTX_PRINCIPAL_ANY=$(ctx lambda:Principal '*')
CTX_PRINCIPAL_ACCT=$(ctx lambda:Principal 123456789012)
ROLE_OK="arn:aws:iam::${ACCT}:role/sls-probe"
ROLE_BAD="arn:aws:iam::${ACCT}:role/not-sls-role"
USER_PROBE="arn:aws:iam::${ACCT}:user/probe"
POLICY_PROBE="arn:aws:iam::${ACCT}:policy/probe"
SLR_AOSS="arn:aws:iam::${ACCT}:role/aws-service-role/observability.aoss.amazonaws.com/AWSServiceRoleForAmazonOpenSearchServerless"
# 시뮬레이터는 액션의 리소스 타입과 안 맞는 ARN 을 주면 무조건 implicitDeny 를 돌려준다.
# 그래서 IAM 액션은 타입에 맞는 ARN 으로, 서비스 액션은 "*" 로 나눠 돌린다 — 섞으면 판정이 무의미해진다.
expect() { # $1 label $2 expected decision(allowed|explicitDeny) $3 severity(fix|reject) $4 resource $5 context, rest = actions
  local label="$1" want="$2" sev="$3" res="$4" ctx="$5" out bad n; shift 5
  out=$(sim "$res" "$ctx" "$@")
  if [[ "$out" == *rror* ]]; then $sev "$label" "simulate 실패: $(echo "$out" | head -1 | mask)"; return; fi
  n=$(echo "$out" | grep -c .)
  if [[ "$n" != "$#" ]]; then $sev "$label" "판정 줄 $n 개 ≠ 요청 액션 $# 개 (출력: $(echo "$out" | head -1 | mask))"; return; fi
  bad=$(echo "$out" | awk -v w="$want" '$2!=w{print $1"="$2}' | tr '\n' ' ')
  if [[ -n "$bad" ]]; then $sev "$label" "기대 $want 아님: $bad"; else pass "$label" "${n}개 전부 $want"; fi
}
# V3a IAM role 생명주기 (sls-* role, 바운더리 컨텍스트 포함)
expect V3a allowed fix "$ROLE_OK" "$CTX_SEOUL $CTX_LAMBDA $CTX_BOUNDARY $CTX_POLICY_OK" \
  iam:CreateRole iam:PutRolePolicy iam:AttachRolePolicy iam:PutRolePermissionsBoundary iam:PassRole iam:DeleteRole iam:DetachRolePolicy iam:DeleteRolePolicy iam:GetRole iam:TagRole
# V3b 서비스 액션 (리소스 *)
expect V3b allowed fix "*" "$CTX_SEOUL $CTX_URL_IAM $CTX_PRINCIPAL_S3" \
  s3:CreateBucket s3:PutObject s3:PutBucketNotification s3:PutBucketPublicAccessBlock lambda:CreateFunction lambda:CreateEventSourceMapping \
  lambda:AddPermission lambda:CreateFunctionUrlConfig \
  dynamodb:CreateTable dynamodb:UpdateTable aoss:CreateCollection aoss:CreateAccessPolicy aoss:CreateSecurityPolicy \
  logs:CreateLogGroup cloudwatch:PutMetricAlarm sqs:CreateQueue sns:CreateTopic sns:Subscribe \
  cloudformation:CreateStack cloudformation:CreateChangeSet
# V3b2 자기 조회 — 정책 리소스가 user/${aws:username} · group/sls-operators 로 한정돼 있어 자기 ARN 으로만 allowed
expect V3b2 allowed fix "$ME" "" iam:GetUser iam:ListAccessKeys iam:ListGroupsForUser iam:SimulatePrincipalPolicy
expect V3b3 allowed fix "arn:aws:iam::${ACCT}:group/$GROUP" "" iam:ListAttachedGroupPolicies iam:ListGroupPolicies
expect V3b4 allowed fix "*" "" iam:GetAccountSummary sts:GetCallerIdentity iam:ListRoles iam:GetPolicy
# V3c OpenSearch Serverless 서비스 연결 role (v1 정책은 여기서 막혀 stack2 가 롤백된다)
expect V3c allowed fix "$SLR_AOSS" "$CTX_SLR_AOSS" iam:CreateServiceLinkedRole
# V3d 비용 읽기 — SCP(조직 정책)나 계정 설정 "IAM 결제 액세스" 가 막는 경우는 키 정책 문제가 아니다
OUT=$(sim "*" "$CTX_SEOUL" ce:GetCostAndUsage budgets:ViewBudget)
BAD=$(echo "$OUT" | awk '$2!="allowed"{print $1"="$2}' | tr '\n' ' ')
if [[ -n "$BAD" ]]; then
  REAL=$(aws ce get-cost-and-usage --time-period "Start=$(date -v-7d +%F 2>/dev/null || date -d '-7 days' +%F),End=$(date +%F)" --granularity MONTHLY --metrics UnblendedCost 2>&1 | mask)
  if echo "$REAL" | grep -q 'service control policy'; then echo "  NOTE V3d — 비용 읽기가 조직 SCP 로 막힘(단독 계정엔 SCP 없음): $BAD"
  else fix V3d "비용 읽기 막힘(정책 누락 또는 계정 설정 'IAM 결제 액세스' 꺼짐): $BAD / $(echo "$REAL" | head -1)"; fi
else pass V3d "ce/budgets 읽기 allowed"; fi

# V4 거부 — 전부 explicitDeny 여야 한다 (implicitDeny 는 GuardDeny 가 아니라 Allow 누락일 뿐이라 통과로 치지 않는다)
expect V4a explicitDeny reject "*" "$CTX_SEOUL" \
  bedrock:InvokeModel bedrock:ListFoundationModels ec2:RunInstances sagemaker:CreateNotebookInstance rds:CreateDBInstance \
  kms:CreateKey apigateway:POST events:PutRule organizations:CreateAccount account:CloseAccount aws-portal:ModifyBilling \
  aoss:UpdateAccountSettings aoss:CreateCollectionGroup aoss:UpdateCollectionGroup \
  lambda:PutProvisionedConcurrencyConfig lambda:PutFunctionRecursionConfig lambda:AddLayerVersionPermission \
  dynamodb:ExportTableToPointInTime dynamodb:CreateGlobalTable dynamodb:CreateTableReplica \
  s3:PutAccountPublicAccessBlock s3:PutBucketObjectLockConfiguration s3:PutObjectRetention logs:PutSubscriptionFilter \
  dynamodb:PutResourcePolicy sqs:AddPermission sns:AddPermission logs:PutResourcePolicy aoss:CreateSecurityConfig s3:PutBucketAcl \
  dynamodb:PurchaseReservedCapacityOfferings
# V4a2 인증 없는 Function URL · 아무에게나(리터럴 *, 다른 계정) 주는 Lambda 권한
expect V4a2 explicitDeny reject "*" "$CTX_SEOUL $CTX_URL_NONE $CTX_PRINCIPAL_ANY" lambda:CreateFunctionUrlConfig lambda:UpdateFunctionUrlConfig lambda:AddPermission
expect V4a3 explicitDeny reject "*" "$CTX_SEOUL $CTX_PRINCIPAL_ACCT" lambda:AddPermission
expect V4b explicitDeny reject "$USER_PROBE" "$CTX_SEOUL" iam:CreateUser iam:CreateAccessKey iam:AttachUserPolicy iam:CreateLoginProfile
expect V4c explicitDeny reject "$POLICY_PROBE" "$CTX_SEOUL" iam:CreatePolicy iam:CreatePolicyVersion
expect V4c2 explicitDeny reject "*" "$CTX_SEOUL" iam:CreateOpenIDConnectProvider iam:CreateSAMLProvider
# V4d sls-* 밖 role 은 바운더리가 있어도 없어도 쓰기·PassRole 전부 명시 거부
expect V4d explicitDeny reject "$ROLE_BAD" "$CTX_SEOUL" iam:CreateRole iam:PutRolePolicy iam:UpdateAssumeRolePolicy sts:AssumeRole
# V4d2 는 허용 관리형(CTX_POLICY_OK)을 넣어 AttachRolePolicy 도 관리형 Deny 가 아니라 경로 Deny 로 막히는지 본다
expect V4d2 explicitDeny reject "$ROLE_BAD" "$CTX_SEOUL $CTX_BOUNDARY $CTX_LAMBDA $CTX_POLICY_OK" iam:CreateRole iam:PutRolePolicy iam:AttachRolePolicy iam:PassRole
# V4e sls-* role 이라도 바운더리 없이 만들거나 인라인 정책을 붙이면 거부 (Lambda role 우회 차단)
expect V4e explicitDeny reject "$ROLE_OK" "$CTX_SEOUL" iam:CreateRole iam:PutRolePolicy iam:DeleteRolePermissionsBoundary
# V4e2 sls-* role 이라도 신뢰 정책 교체는 거부 (외부 계정으로 trust 를 돌리는 경로, v5)
expect V4e2 explicitDeny reject "$ROLE_OK" "$CTX_SEOUL $CTX_BOUNDARY" iam:UpdateAssumeRolePolicy
# V4f 바운더리는 맞아도 관리형 Admin 을 role 에 붙이면 거부
expect V4f explicitDeny reject "$ROLE_OK" "$CTX_SEOUL $CTX_BOUNDARY $CTX_POLICY_ADMIN" iam:AttachRolePolicy
# V4g PassRole 을 ec2 로 넘기면 거부 · 다른 서비스의 서비스 연결 role 거부
expect V4g explicitDeny reject "$ROLE_OK" "$CTX_SEOUL $CTX_EC2" iam:PassRole
expect V4h explicitDeny reject "arn:aws:iam::${ACCT}:role/aws-service-role/ec2.amazonaws.com/AWSServiceRoleForEC2" "$CTX_SLR_EC2" iam:CreateServiceLinkedRole
# V4i 서울 밖 리전
expect V4i explicitDeny reject "*" "$CTX_US" s3:CreateBucket lambda:CreateFunction aoss:CreateCollection
# V4j 경로가 붙은 role (role/sls-x/probe) — "sls-*" 의 * 가 / 까지 먹어 접두사 검사를 우회하는 경로, 바운더리·lambda 여도 거부 (v5)
expect V4j explicitDeny reject "arn:aws:iam::${ACCT}:role/sls-x/probe" "$CTX_SEOUL $CTX_BOUNDARY $CTX_LAMBDA" iam:CreateRole iam:PassRole
[[ $REJECT == 1 ]] && bail

# ---------- V7 Bedrock 실호출 (읽기 전용 · 서울 — us-east-1 이면 리전 Deny 가 대신 막아 Bedrock 판정이 안 된다) ----------
OUT=$(aws bedrock list-foundation-models --region $REGION 2>&1)
if echo "$OUT" | grep -q 'explicit deny'; then pass V7 "bedrock(서울) explicit deny"
else reject V7 "bedrock 이 명시 거부되지 않음: $(echo "$OUT" | head -1 | mask)"; fi

# ---------- V8 정책 원본 diff (3개 전부 반려 — 원본이 없어도 반려: 무엇과 대조했는지 모르는 통과는 없다) ----------
for n in "${POLICIES[@]}"; do
  ARN="arn:aws:iam::${ACCT}:policy/$n"
  VER=$(aws iam get-policy --policy-arn "$ARN" --query Policy.DefaultVersionId --output text 2>/dev/null)
  if [[ -z "$VER" || "$VER" == "None" ]]; then reject V8 "$n 없음/조회 불가"; continue; fi
  LIVE=$(aws iam get-policy-version --policy-arn "$ARN" --version-id "$VER" --query PolicyVersion.Document --output json 2>/dev/null | python3 -c 'import sys,json;print(json.dumps(json.load(sys.stdin),sort_keys=True))')
  ORIG=$(python3 -c 'import sys,json;print(json.dumps(json.load(open(sys.argv[1])),sort_keys=True))' "$POLDIR/$n.json" 2>/dev/null)
  if [[ -z "$ORIG" ]]; then reject V8 "원본 $POLDIR/$n.json 없음 — 대조 불가"
  elif [[ "$LIVE" == "$ORIG" ]]; then pass V8 "$n $VER == 원본"
  else reject V8 "$n $VER 이 원본과 다름"; fi
done

# ---------- V9 계정 위생 ----------
OUT=$(aws iam get-account-summary --query 'SummaryMap.[AccountMFAEnabled,AccountAccessKeysPresent]' --output text 2>&1 | mask)
if [[ "$OUT" == $'1	0' ]]; then pass V9 "루트 MFA 1 · 루트 키 0"
else fix V9 "MFAEnabled/RootKeysPresent = $OUT (1/0 이어야 함 — 01 § 3.1, 계정 관리자 조치)"; fi
BPA=$(aws s3control get-public-access-block --account-id "$ACCT" --query 'PublicAccessBlockConfiguration.[BlockPublicAcls,IgnorePublicAcls,BlockPublicPolicy,RestrictPublicBuckets]' --output text 2>&1 | mask)
if [[ "$BPA" == $'True\tTrue\tTrue\tTrue' ]]; then pass V9 "계정 수준 S3 퍼블릭 액세스 차단 4개 켜짐"
else fix V9 "계정 수준 S3 퍼블릭 액세스 차단이 전부 켜져 있지 않음: $(echo "$BPA" | grep -v '^$' | head -1) (01 § 3.7, 계정 관리자 조치)"; fi
# V9b sls-* role 신뢰 정책 — lambda.amazonaws.com 외 주체가 있으면 반려 (키를 지워도 남는 외부 접근 경로).
# 이름이 아니라 ARN 으로 거른다: 키가 만질 수 있는 범위는 정책의 role/sls-* 이고, 경로가 붙은 role
# (role/sls-x/이름) 은 이름이 sls- 로 시작하지 않아도 여기에 들어온다. 조회 실패는 반려(run).
run V9b iam list-roles --query 'Roles[?contains(Arn, `:role/sls-`)].RoleName' --output text
ROLES=$(echo "$OUT" | tr '\t' '\n' | grep -v '^None$' | grep -v '^$')
BADTRUST=""; NOBOUND=""
for r in $ROLES; do
  run V9b iam get-role --role-name "$r" --query 'Role.AssumeRolePolicyDocument.Statement[].Principal' --output json
  P=$(echo "$OUT" | tr -d ' \n')
  [[ "$P" == '[{"Service":"lambda.amazonaws.com"}]' ]] || BADTRUST+="$r=$(echo "$P" | mask) "
  run V9c iam get-role --role-name "$r" --query 'Role.PermissionsBoundary.PermissionsBoundaryArn' --output text
  [[ "$OUT" == "arn:aws:iam::$ACCT:policy/SlsLambdaBoundary" ]] || NOBOUND+="$r "
done
if [[ -n "$BADTRUST" ]]; then reject V9b "sls-* role 신뢰 정책에 lambda 외 주체: $BADTRUST"
else pass V9b "sls-* role $(echo $ROLES | wc -w | tr -d ' ')개(경로 포함), 신뢰 주체 전부 lambda.amazonaws.com"; fi

# ---------- V9c 계정에 원래 있던 자원 (키가 빌려 쓸 수 있는 기존 role·함수·스택) — 조회 실패는 반려(run) ----------
# a) sls-* role 은 전부 SlsLambdaBoundary 를 달고 있어야 한다 — 바운더리 없는 기존 role 은 PassRole 로 Lambda 에 붙여 그 권한으로 코드를 돌릴 수 있다
if [[ -n "$NOBOUND" ]]; then reject V9c "SlsLambdaBoundary 가 없는 sls-* role: $NOBOUND"
else pass V9c "sls-* role 전부 SlsLambdaBoundary"; fi
# b) 서울 Lambda 함수는 전부 sls-* role 로 돌아야 한다 — 키는 아무 함수에나 UpdateFunctionCode 를 할 수 있어, 남의 role 로 도는 함수는 그 role 권한을 빌리는 통로다
run V9c lambda list-functions --region $REGION --query 'Functions[?contains(Role, `:role/sls-`) == `false`].FunctionName' --output text
FNS=$(echo "$OUT" | tr '\t' '\n' | grep -v '^None$' | grep -v '^$')
if [[ -n "$FNS" ]]; then reject V9c "sls-* 밖 role 로 도는 Lambda 함수(서울): $(echo $FNS | mask)"
else pass V9c "서울 Lambda 함수 전부 sls-* role (또는 0개)"; fi
# c) CloudFormation 스택 — 서비스 role(RoleARN) 이 붙은 스택은 키가 UpdateStack 으로 그 role 권한을 빌린다(반려).
#    이름이 sls-*·aws-sam-cli-managed-default 가 아닌 스택은 전용 계정 전제와 어긋나는 기존 자산(수정 요청).
run V9c cloudformation describe-stacks --region $REGION --query 'Stacks[?RoleARN].StackName' --output text
STK_ROLE=$(echo "$OUT" | tr '\t' '\n' | grep -v '^None$' | grep -v '^$')
if [[ -n "$STK_ROLE" ]]; then reject V9c "서비스 role(RoleARN) 이 붙은 스택(서울): $(echo $STK_ROLE | mask)"
else pass V9c "서비스 role 이 붙은 스택 0개"; fi
run V9c cloudformation describe-stacks --region $REGION --query 'Stacks[].StackName' --output text
STK_OTHER=$(echo "$OUT" | tr '\t' '\n' | grep -v '^None$' | grep -v '^$' | grep -v '^sls-' | grep -vx 'aws-sam-cli-managed-default')
if [[ -n "$STK_OTHER" ]]; then fix V9c "sls-*·aws-sam-cli-managed-default 가 아닌 스택(서울) — 전용 계정이 아님, 계정 관리자에게 확인: $(echo $STK_OTHER | mask)"
else pass V9c "서울 스택 이름 전부 sls-* 또는 aws-sam-cli-managed-default"; fi
[[ $REJECT == 1 ]] && bail

# ========== 여기부터 쓰기 호출 — 반려 0 인 키만 여기까지 온다 ==========

# ---------- V5 리전 봉쇄 실호출 ----------
B5="sls-probe-$RANDOM$RANDOM"
OUT=$(aws s3api create-bucket --bucket "$B5" --region us-east-1 2>&1)
if echo "$OUT" | grep -q 'explicit deny'; then pass V5 "us-east-1 버킷 생성 explicit deny"
elif echo "$OUT" | grep -q AccessDenied; then fix V5 "us-east-1 거부는 되지만 explicit deny 가 아님(GuardDeny 리전 문 누락?): $(echo "$OUT" | head -1 | mask)"
else
  fix V5 "us-east-1 버킷 생성이 막히지 않음 (생성됐으면 즉시 삭제)"
  aws s3api delete-bucket --bucket "$B5" --region us-east-1 >/dev/null 2>&1 || echo "  NOTE V5 — 버킷 $B5 (us-east-1) 삭제 실패, 남아 있음: 수동 삭제"
fi

# ---------- V6 서울 스모크 ----------
# 버킷 이름에 난수, s3 호출에 --expected-bucket-owner — 이름이 겹친 남의 버킷에 쓰거나 지우지 않는다.
# 만든 것만 지운다: 생성이 실패하면(이미 있던 버킷·로그 그룹) 그 뒤 삭제를 건너뛴다.
B="sls-probe-$(date +%s)-$RANDOM"; V6OK=1; V6MSG=""
step() { local out; out=$("$@" 2>&1) && return 0; V6OK=0; V6MSG+="[$2 $3] $(echo "$out" | grep -v '^$' | head -1 | mask); "; return 1; }
if step aws s3api create-bucket --bucket "$B" --region $REGION --create-bucket-configuration LocationConstraint=$REGION; then
  printf 'probe\n' > "$PROBE_FILE"
  # `aws s3 cp/rm` 은 --expected-bucket-owner 를 받지 않는다(ParamValidation, 2026-09-29 실측) — s3api 로 부른다
  step aws s3api put-object --bucket "$B" --key probe.txt --body "$PROBE_FILE" --region $REGION --expected-bucket-owner "$ACCT"
  step aws s3api delete-object --bucket "$B" --key probe.txt --region $REGION --expected-bucket-owner "$ACCT"
  if ! aws s3api delete-bucket --bucket "$B" --region $REGION --expected-bucket-owner "$ACCT" >/dev/null 2>&1; then
    V6OK=0; V6MSG+="[delete-bucket] 실패 — 버킷 $B 가 남아 있음, 수동 삭제; "
  fi
fi
if step aws logs create-log-group --log-group-name /sls/probe --region $REGION; then
  step aws logs delete-log-group --log-group-name /sls/probe --region $REGION \
    || echo "  NOTE V6 — 로그 그룹 /sls/probe (서울) 삭제 실패, 남아 있음: 수동 삭제"
fi
step aws dynamodb list-tables --region $REGION
step aws opensearchserverless list-collections --region $REGION
step aws lambda list-functions --region $REGION --max-items 1
step aws cloudformation list-stacks --region $REGION --max-items 1
if [[ $V6OK == 1 ]]; then pass V6 "s3/logs/dynamodb/opensearchserverless/lambda/cfn 서울 호출 성공"; else fix V6 "$V6MSG"; fi

echo "== result: $([[ $REJECT == 1 ]] && echo REJECT || { [[ $FIX == 1 ]] && echo FIX-REQUIRED || echo PASS; }) =="
[[ $REJECT == 1 ]] && exit 1
[[ $FIX == 1 ]] && exit 2
exit 0
