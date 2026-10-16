#!/usr/bin/env bash
# staff-policy-sim.sh — 실무자 유형 정책 3개(적재·조회·수정)가 그룹 조합대로 붙었을 때의
# 허용·거부 표를 `iam simulate-custom-policy` 로 판정하고, 정책 3개의 validate-policy 를 돌린다.
# 정책 문서만 평가하는 설계 검증이다 — 계정에 아무것도 만들지 않고 과금이 없다.
#
# 사용: ./staff-policy-sim.sh <profile> [policies-dir] > staff-sim.txt
#   profile       iam:SimulateCustomPolicy 와 access-analyzer:ValidatePolicy 가 되는 프로파일
#                 (어느 계정이든 된다. 배포 키는 둘 다 안 된다)
#   policies-dir  정책 JSON 폴더, 기본 <이 스크립트>/../policies
#
# 그룹 조합(3부 § 3.2): 적재 = Push + GuardDeny, 조회 = Query + GuardDeny, 수정 = Query + Edit + GuardDeny.
# 옵션 Athena(스킬 aws-athena): 폴더에 SlsStaffAthena.json·SlsAthenaAllow.json 이 둘 다 있으면
# 실무자 Athena 조합(조회 + StaffAthena)과 배포 키 옵션 조합(Allow + GuardDeny + AthenaAllow)의 설계 판정 25행과 린터 2줄을 더한다.
# 하나라도 없으면 옵션 절을 통째로 건너뛰어 기존 47행 그대로다.
# 종료 코드: 0 = 전부 통과, 1 = FAIL 이 하나라도 있음(판정을 못 한 호출 포함), 64 = 인자 오류.
# 스크립트는 로그 파일을 쓰지 않는다 — 호출하는 쪽이 표준 출력을 로그로 받는다. 머리의 cksum 줄이
# "이 로그가 어느 정책의 결과인지" 를 고정한다(sha 가 아니라 cksum: 12자리 숫자열이 생기지 않아 mask 에 걸리지 않는다).
# 끝 줄이 `== result: PASS ==` 가 아니면 통과가 아니다. 중간에 끊기면 `== result: INCOMPLETE ==` 가 찍힌다.
# 필요: AWS CLI v2. ARN 의 계정 자리는 가짜 값이고 출력은 <acct> 로 마스킹한다.

set -u -f   # -f: 리소스 "*" 가 파일 글롭으로 풀리지 않게
[[ $# -ge 1 ]] || { echo "사용: $0 <profile> [policies-dir]" >&2; exit 64; }
PROFILE="$1"
SRCDIR="${2:-$(dirname "$0")/../policies}"
[[ -d "$SRCDIR" ]] || { echo "정책 폴더 없음" >&2; exit 64; }
export AWS_PROFILE="$PROFILE"
export AWS_PAGER=""
REGION=ap-northeast-2
STAFF=(SlsStaffPush SlsStaffQuery SlsStaffEdit)
EXPECTED_ROWS=47   # 아래 expect 호출 수(옵션 절 제외). 행을 더하거나 빼면 같이 고친다 — 행이 조용히 사라지는 것을 잡는다
OPTION_ROWS=25     # 옵션 절 expect 호출 수
OPTION=(SlsStaffAthena SlsAthenaAllow SlsServerlessAllow)
OPT=0; [[ -f "$SRCDIR/SlsStaffAthena.json" && -f "$SRCDIR/SlsAthenaAllow.json" ]] && OPT=1

# 정책 4개를 한 번만 읽는다: 임시 폴더에 복사해 cksum·시뮬레이션·린터가 전부 같은 사본을 본다
# (실행에 1분쯤 걸려, 원본을 세 번 따로 읽으면 그 사이 고친 파일이 섞인다).
DONE=0
POLDIR=$(mktemp -d) || { echo "임시 폴더를 만들지 못함" >&2; exit 64; }
trap 'rm -rf "$POLDIR"; [[ $DONE == 1 ]] || echo "== result: INCOMPLETE =="' EXIT
COPY=("${STAFF[@]}" SlsGuardDeny); [[ $OPT == 1 ]] && COPY+=("${OPTION[@]}")
for n in "${COPY[@]}"; do
  cp "$SRCDIR/$n.json" "$POLDIR/$n.json" || { echo "정책 파일을 읽지 못함: $n.json" >&2; DONE=1; exit 64; }
done

# pass·fail·mask·ctx·expect 는 verify.sh 에서 가져왔다. expect 는 등급 인자를 빼고(여기는 FAIL 한 종류다)
# 기대값에 implicitDeny 를 더했고, 호출의 종료 코드를 먼저 본다(오류 문구에 "rror" 가 없는 실패가 있다).
FAILED=0; ROWS=0
pass() { printf '  PASS %s — %s\n' "$1" "$2"; }
fail() { printf '  FAIL %s — %s\n' "$1" "$2"; FAILED=1; }
mask() { sed -E 's/[0-9]{12}/<acct>/g'; }
first_line() { grep -m1 . | mask; }   # aws 오류 출력은 첫 줄이 비어 있다
ctx() { printf 'ContextKeyName=%s,ContextKeyValues=%s,ContextKeyType=string' "$1" "$2"; }
CTX_SEOUL=$(ctx aws:RequestedRegion $REGION)
CTX_US=$(ctx aws:RequestedRegion us-east-1)
AWS_TIMEOUTS=(--cli-connect-timeout 10 --cli-read-timeout 30)

PUSH=$(cat "$POLDIR/SlsStaffPush.json"); QUERY=$(cat "$POLDIR/SlsStaffQuery.json")
EDIT=$(cat "$POLDIR/SlsStaffEdit.json"); GUARD=$(cat "$POLDIR/SlsGuardDeny.json")
if [[ $OPT == 1 ]]; then
  SATHENA=$(cat "$POLDIR/SlsStaffAthena.json"); CATHENA=$(cat "$POLDIR/SlsAthenaAllow.json"); ALLOW=$(cat "$POLDIR/SlsServerlessAllow.json")
fi
sim() { # $1 = 그룹 조합, $2 = resource arns (space sep), $3 = context entries (space sep), rest = actions
  local combo="$1" res="$2" ctx="$3" docs; shift 3
  case "$combo" in   # 그룹에 붙는 관리형 정책을 그대로 넣는다
    push)     docs=("$PUSH" "$GUARD") ;;
    query)    docs=("$QUERY" "$GUARD") ;;
    edit)     docs=("$QUERY" "$EDIT" "$GUARD") ;;
    editonly) docs=("$EDIT" "$GUARD") ;;   # 잘못된 조합: 조회 정책이 빠진 수정 그룹
    athena)   docs=("$QUERY" "$SATHENA" "$GUARD") ;;     # 옵션: 조회 그룹 + 실무자 Athena
    athenaonly) docs=("$SATHENA" "$GUARD") ;;            # 옵션: 실무자 Athena 만(S3 범위가 sidecar/ 로 닫히는지)
    deployer) docs=("$ALLOW" "$GUARD" "$CATHENA") ;;   # 옵션: 배포 키 + AthenaAllow
    deployeroff) docs=("$ALLOW" "$GUARD") ;;           # 옵션 꺼짐: GuardDeny 허용 목록만으로는 아무것도 안 열린다
    *)        echo "모르는 조합 $combo"; return 2 ;;
  esac
  # shellcheck disable=SC2086
  aws iam simulate-custom-policy "${AWS_TIMEOUTS[@]}" --policy-input-list "${docs[@]}" --action-names "$@" \
    --resource-arns $res ${ctx:+--context-entries $ctx} \
    --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text 2>&1
}
# 시뮬레이터는 액션의 리소스 타입과 안 맞는 ARN 을 주면 무조건 implicitDeny 를 돌려준다.
# 그래서 호출을 리소스 타입별로 나눈다 — 섞으면 판정이 무의미해진다.
expect() { # $1 label $2 그룹 조합 $3 expected decision(allowed|implicitDeny|explicitDeny) $4 resource $5 context, rest = actions
  local label="$1" combo="$2" want="$3" res="$4" ctx="$5" out rc bad n; shift 5
  ROWS=$((ROWS + 1))
  out=$(sim "$combo" "$res" "$ctx" "$@"); rc=$?
  if [[ $rc != 0 || "$out" == *rror* ]]; then fail "$label" "[$combo] simulate 실패(rc=$rc): $(echo "$out" | first_line)"; return; fi
  n=$(echo "$out" | grep -c .)
  if [[ "$n" != "$#" ]]; then fail "$label" "[$combo] 판정 줄 $n 개 ≠ 요청 액션 $# 개 (출력: $(echo "$out" | first_line))"; return; fi
  bad=$(echo "$out" | awk -v w="$want" '$2!=w{print $1"="$2}' | tr '\n' ' ')
  if [[ -n "$bad" ]]; then fail "$label" "[$combo] 기대 $want 아님: $bad"; else pass "$label" "[$combo] ${n}개 전부 $want — $*"; fi
}

ACCT=123456789012   # 가짜 계정. 정책 문서만 평가하므로 실제 계정과 무관하다
BUCKET="arn:aws:s3:::sls-test-data-$ACCT"
OBJECT="$BUCKET/in/sample.json"
OTHER_OBJECT="arn:aws:s3:::company-files/in/sample.json"
# sls- 로 시작하지만 -data- 가 없는 버킷(웹 버킷 같은 것). 패턴의 -data- 구간이 이것을 막는다
NODATA_BUCKET="arn:aws:s3:::sls-web-$ACCT"
NODATA_OBJECT="$NODATA_BUCKET/in/sample.json"
TABLE="arn:aws:dynamodb:$REGION:$ACCT:table/sls-test-docs"
TABLE_INDEX="$TABLE/index/by-date"
TABLE_STREAM="$TABLE/stream/2026-10-01T00:00:00.000"
OTHER_TABLE="arn:aws:dynamodb:$REGION:$ACCT:table/company-orders"
# sls- 로 시작하지만 -docs 로 끝나지 않는 표. 패턴의 -docs 끝이 이것을 막는다
NODOCS_TABLE="arn:aws:dynamodb:$REGION:$ACCT:table/sls-test-orders"
NODOCS_INDEX="$NODOCS_TABLE/index/by-date"
COLLECTION="arn:aws:aoss:$REGION:$ACCT:collection/abcdefghij0123456789"
USER_ARN="arn:aws:iam::$ACCT:user/staff-hong"
GROUP_ARN="arn:aws:iam::$ACCT:group/sls-staff-edit"

echo "== staff-policy-sim: 직원 유형 3개 × 그룹 조합 (simulate-custom-policy) =="
for n in "${COPY[@]}"; do
  # 인자가 아니라 표준 입력으로 준다 — 파일을 인자로 주면 출력에 경로가 붙는다
  SUM=$(cksum < "$POLDIR/$n.json") || SUM=""
  [[ "$SUM" =~ ^[0-9]+\ [0-9]+$ ]] || { echo "cksum 실패: $n.json" >&2; exit 1; }
  printf 'cksum %s %s\n' "$n" "$SUM"
done

echo "-- 적재 (SlsStaffPush + SlsGuardDeny)"
expect P1 push allowed "$OBJECT" "$CTX_SEOUL" s3:PutObject s3:AbortMultipartUpload s3:ListMultipartUploadParts
expect P2 push allowed "$BUCKET" "$CTX_SEOUL" s3:ListBucket s3:GetBucketLocation
expect P3 push implicitDeny "$OBJECT" "$CTX_SEOUL" s3:GetObject s3:GetObjectVersion s3:DeleteObject s3:DeleteObjectVersion
expect P4 push implicitDeny "$OTHER_OBJECT" "$CTX_SEOUL" s3:PutObject
expect P4b push implicitDeny "$NODATA_OBJECT" "$CTX_SEOUL" s3:PutObject
expect P5 push implicitDeny "$TABLE" "$CTX_SEOUL" dynamodb:GetItem dynamodb:PutItem
expect P6 push implicitDeny "$COLLECTION" "$CTX_SEOUL" aoss:APIAccessAll

echo "-- 조회 (SlsStaffQuery + SlsGuardDeny)"
expect Q1 query allowed "$OBJECT" "$CTX_SEOUL" s3:GetObject s3:GetObjectVersion
expect Q2 query allowed "$BUCKET" "$CTX_SEOUL" s3:ListBucket s3:GetBucketLocation
expect Q3 query allowed "$TABLE" "$CTX_SEOUL" dynamodb:GetItem dynamodb:BatchGetItem dynamodb:Query dynamodb:Scan dynamodb:DescribeTable
expect Q3b query allowed "$TABLE_INDEX" "$CTX_SEOUL" dynamodb:Query dynamodb:Scan
expect Q4 query allowed "*" "$CTX_SEOUL" dynamodb:ListTables aoss:ListCollections aoss:BatchGetCollection
expect Q5 query allowed "$COLLECTION" "$CTX_SEOUL" aoss:APIAccessAll
expect Q6 query implicitDeny "$OBJECT" "$CTX_SEOUL" s3:PutObject s3:DeleteObject
expect Q7 query implicitDeny "$TABLE" "$CTX_SEOUL" dynamodb:PutItem dynamodb:UpdateItem dynamodb:DeleteItem dynamodb:BatchWriteItem
expect Q8 query implicitDeny "$TABLE_STREAM" "$CTX_SEOUL" dynamodb:GetRecords dynamodb:GetShardIterator dynamodb:DescribeStream
expect Q9 query implicitDeny "$OTHER_TABLE" "$CTX_SEOUL" dynamodb:GetItem dynamodb:Scan
expect Q9b query implicitDeny "$NODOCS_TABLE" "$CTX_SEOUL" dynamodb:GetItem dynamodb:Query dynamodb:Scan
expect Q9c query implicitDeny "$NODOCS_INDEX" "$CTX_SEOUL" dynamodb:Query dynamodb:Scan
expect Q10 query implicitDeny "$OTHER_OBJECT" "$CTX_SEOUL" s3:GetObject
expect Q10b query implicitDeny "$NODATA_OBJECT" "$CTX_SEOUL" s3:GetObject
expect Q10c query implicitDeny "$NODATA_BUCKET" "$CTX_SEOUL" s3:ListBucket
expect Q11 query implicitDeny "$COLLECTION" "$CTX_SEOUL" aoss:DeleteCollection aoss:UpdateCollection
# aoss:CreateCollection 은 리소스 타입이 없어 컬렉션 ARN 으로 치면 정책과 무관하게 implicitDeny 다(2026-10-01 실측) — "*" 로 친다
expect Q12 query implicitDeny "*" "$CTX_SEOUL" aoss:CreateCollection aoss:CreateAccessPolicy aoss:UpdateAccessPolicy

echo "-- 수정 (SlsStaffQuery + SlsStaffEdit + SlsGuardDeny)"
expect E1 edit allowed "$TABLE" "$CTX_SEOUL" dynamodb:PutItem dynamodb:UpdateItem dynamodb:DeleteItem dynamodb:BatchWriteItem dynamodb:GetItem dynamodb:Query dynamodb:Scan
expect E2 edit allowed "$OBJECT" "$CTX_SEOUL" s3:GetObject s3:GetObjectVersion
expect E3 edit allowed "$COLLECTION" "$CTX_SEOUL" aoss:APIAccessAll
expect E4 edit implicitDeny "$TABLE" "$CTX_SEOUL" dynamodb:DeleteTable dynamodb:CreateTable dynamodb:UpdateTable
expect E5 edit implicitDeny "$TABLE_STREAM" "$CTX_SEOUL" dynamodb:GetRecords dynamodb:GetShardIterator dynamodb:DescribeStream
expect E6 edit implicitDeny "$OBJECT" "$CTX_SEOUL" s3:PutObject s3:DeleteObject
expect E7 edit implicitDeny "$OTHER_TABLE" "$CTX_SEOUL" dynamodb:PutItem dynamodb:DeleteItem
expect E7b edit implicitDeny "$NODOCS_TABLE" "$CTX_SEOUL" dynamodb:PutItem dynamodb:DeleteItem dynamodb:GetItem
expect E8 edit implicitDeny "$COLLECTION" "$CTX_SEOUL" aoss:DeleteCollection aoss:UpdateCollection
expect E9 edit implicitDeny "*" "$CTX_SEOUL" aoss:CreateCollection aoss:CreateAccessPolicy aoss:UpdateAccessPolicy

echo "-- 잘못된 조합 (조회 정책이 빠진 수정 그룹: SlsStaffEdit + SlsGuardDeny)"
expect X1 editonly implicitDeny "$TABLE" "$CTX_SEOUL" dynamodb:GetItem dynamodb:Query dynamodb:Scan

echo "-- 세 유형 공통: GuardDeny 의 명시 거부 (허용 목록 밖 서비스 · 서울 밖 리전 · IAM 권한 상승)"
for combo in push query edit; do
  expect G1 "$combo" explicitDeny "*" "$CTX_SEOUL" bedrock:InvokeModel ec2:RunInstances
  expect G2 "$combo" explicitDeny "$USER_ARN" "$CTX_SEOUL" iam:CreateUser iam:CreateAccessKey
  expect G3 "$combo" explicitDeny "$GROUP_ARN" "$CTX_SEOUL" iam:AttachGroupPolicy
done
# 서울 밖 리전: 리전 Deny 의 예외(s3:GetBucketLocation·s3:ListAllMyBuckets·iam:*)가 아닌, 그 유형이 서울에서는 되는 액션으로 친다
expect G4 push explicitDeny "$OBJECT" "$CTX_US" s3:PutObject
expect G4 query explicitDeny "$TABLE" "$CTX_US" dynamodb:GetItem
expect G4 edit explicitDeny "$TABLE" "$CTX_US" dynamodb:PutItem

if [[ $OPT == 1 ]]; then
  WG="arn:aws:athena:$REGION:$ACCT:workgroup/sls-test-query"
  WG_PRIMARY="arn:aws:athena:$REGION:$ACCT:workgroup/primary"
  GLUE_DB="arn:aws:glue:$REGION:$ACCT:database/sls_test"
  GLUE_TBL="arn:aws:glue:$REGION:$ACCT:table/sls_test/llm_gateway_log"
  GLUE_OTHER_TBL="arn:aws:glue:$REGION:$ACCT:table/default/t"
  SIDECAR_OBJ="$BUCKET/sidecar/llm/2026-10-12/a.jsonl"
  RAW_OBJ="$BUCKET/raw/llm/2026-10-12/a.json"
  RESULTS_BUCKET="arn:aws:s3:::sls-test-query-results-$ACCT"
  RESULTS_OBJ="$RESULTS_BUCKET/results/q.csv"
  CTX_PREFIX_SIDECAR=$(ctx s3:prefix sidecar/llm/2026-10-12/)
  CTX_PREFIX_RAW=$(ctx s3:prefix raw/)
  CAPACITY_SPARK_ETL=(athena:CreateCapacityReservation athena:PutCapacityAssignmentConfiguration athena:StartSession athena:StartCalculationExecution
    athena:CreateNotebook athena:CreateDataCatalog glue:CreateJob glue:StartJobRun glue:CreateCrawler glue:StartCrawler
    glue:CreateDevEndpoint glue:CreateSession glue:PutResourcePolicy glue:CreateConnection)

  echo "-- 옵션: 실무자 Athena (SlsStaffQuery + SlsStaffAthena + SlsGuardDeny)"
  expect A1 athena allowed "$WG" "$CTX_SEOUL" athena:StartQueryExecution athena:StopQueryExecution athena:GetQueryExecution athena:GetQueryResults athena:GetWorkGroup
  expect A2 athena allowed "$GLUE_TBL" "$CTX_SEOUL" glue:GetTable glue:GetPartitions
  expect A3 athena allowed "$GLUE_DB" "$CTX_SEOUL" glue:GetDatabase glue:GetTables
  expect A4 athena allowed "*" "$CTX_SEOUL" athena:ListWorkGroups athena:ListDataCatalogs athena:ListDatabases
  expect A5 athena implicitDeny "$WG" "$CTX_SEOUL" athena:CreateWorkGroup athena:UpdateWorkGroup athena:DeleteWorkGroup
  expect A6 athena implicitDeny "$WG_PRIMARY" "$CTX_SEOUL" athena:StartQueryExecution
  expect A7 athena implicitDeny "$GLUE_TBL" "$CTX_SEOUL" glue:CreateTable glue:UpdateTable glue:DeleteTable
  expect A8 athena implicitDeny "$GLUE_OTHER_TBL" "$CTX_SEOUL" glue:GetTable
  expect A9 athena explicitDeny "*" "$CTX_SEOUL" "${CAPACITY_SPARK_ETL[@]}"
  expect A10 athena explicitDeny "$WG" "$CTX_US" athena:StartQueryExecution
  expect A11 query implicitDeny "$WG" "$CTX_SEOUL" athena:StartQueryExecution
  echo "-- 옵션: 실무자 Athena 만 (SlsStaffAthena + SlsGuardDeny) — S3 는 sidecar/ 와 결과 버킷뿐"
  expect A12 athenaonly allowed "$BUCKET" "$CTX_SEOUL $CTX_PREFIX_SIDECAR" s3:ListBucket
  expect A13 athenaonly implicitDeny "$BUCKET" "$CTX_SEOUL $CTX_PREFIX_RAW" s3:ListBucket
  expect A14 athenaonly allowed "$SIDECAR_OBJ" "$CTX_SEOUL" s3:GetObject
  expect A15 athenaonly implicitDeny "$RAW_OBJ" "$CTX_SEOUL" s3:GetObject
  expect A16 athenaonly implicitDeny "$SIDECAR_OBJ" "$CTX_SEOUL" s3:PutObject s3:DeleteObject
  expect A17 athenaonly allowed "$RESULTS_OBJ" "$CTX_SEOUL" s3:GetObject s3:PutObject s3:AbortMultipartUpload s3:ListMultipartUploadParts

  echo "-- 옵션: 배포 키 (SlsServerlessAllow + SlsGuardDeny + SlsAthenaAllow) — 설계 판정, 실키는 verify.sh V3e·V4k·V4l"
  expect C1 deployer allowed "$WG" "$CTX_SEOUL" athena:StartQueryExecution athena:GetQueryResults athena:GetWorkGroup athena:CreateWorkGroup \
    athena:UpdateWorkGroup athena:DeleteWorkGroup athena:ListTagsForResource
  expect C2 deployer allowed "$GLUE_TBL" "$CTX_SEOUL" glue:CreateTable glue:GetTable glue:UpdateTable glue:DeleteTable glue:GetPartitions
  expect C3 deployer allowed "$GLUE_DB" "$CTX_SEOUL" glue:CreateDatabase glue:GetDatabase glue:DeleteDatabase
  expect C4 deployer explicitDeny "*" "$CTX_SEOUL" "${CAPACITY_SPARK_ETL[@]}"
  expect C5 deployer implicitDeny "$WG_PRIMARY" "$CTX_SEOUL" athena:StartQueryExecution athena:UpdateWorkGroup
  expect C6 deployer implicitDeny "$GLUE_OTHER_TBL" "$CTX_SEOUL" glue:CreateTable glue:DeleteTable
  echo "-- 옵션 꺼짐: 배포 키 (SlsServerlessAllow + SlsGuardDeny) — GuardDeny 허용 목록만으로는 열리지 않는다"
  expect C7 deployeroff implicitDeny "$WG" "$CTX_SEOUL" athena:StartQueryExecution athena:CreateWorkGroup
  expect C8 deployeroff implicitDeny "$GLUE_DB" "$CTX_SEOUL" glue:CreateDatabase glue:GetDatabase
  EXPECTED_ROWS=$((EXPECTED_ROWS + OPTION_ROWS))
fi

[[ $ROWS == "$EXPECTED_ROWS" ]] || fail ROWS "판정 행 $ROWS 개 ≠ 기대 $EXPECTED_ROWS 개 (행이 빠졌거나 EXPECTED_ROWS 를 안 고쳤다)"

echo "-- 알려진 한계 (결과를 그대로 적고 PASS·FAIL 에 세지 않는다. 판정을 못 하면 FAIL)"
limit() { # $1 label $2 그룹 조합 $3 resource $4 action — ARN 의 * 가 / 까지 삼켜서 생기는, 패턴으로 못 막는 경로
  local out rc
  out=$(sim "$2" "$3" "$CTX_SEOUL" "$4"); rc=$?
  if [[ $rc == 0 && "$out" =~ ^$4[[:space:]](allowed|implicitDeny|explicitDeny)$ ]]; then
    echo "  NOTE $1 — [$2] $(echo "$3" | mask) 에 $4=${BASH_REMATCH[1]}"
  else fail "$1" "simulate 실패(rc=$rc): $(echo "$out" | first_line)"; fi
}
# L1: sls- 로 시작하는 다른 버킷의 …-data-…/ 키 경로가 객체 패턴에 맞는다
limit L1 push "arn:aws:s3:::sls-other/x-data-y/z" s3:PutObject
# L2: sls- 로 시작하는 다른 표에 이름이 -docs 로 끝나는 인덱스가 있으면 표 패턴(table/sls-*-docs)에 맞아 그 인덱스를 읽는다
limit L2 query "$NODOCS_TABLE/index/by-docs" dynamodb:Query

echo "-- validate-policy (콘솔 정책 편집기 린터와 같은 엔진)"
lint() { aws accessanalyzer validate-policy "${AWS_TIMEOUTS[@]}" --region $REGION --policy-type IDENTITY_POLICY \
  --policy-document "file://$POLDIR/$1.json" --query "$2" --output text 2>&1; }
LINT=("${STAFF[@]}"); [[ $OPT == 1 ]] && LINT+=(SlsStaffAthena SlsAthenaAllow)
for n in "${LINT[@]}"; do
  # 건수를 숫자로 받는다 — 빈 출력을 "finding 없음" 으로 읽지 않는다
  OUT=$(lint "$n" 'length(findings)'); RC=$?
  if [[ $RC != 0 || ! "$OUT" =~ ^[0-9]+$ ]]; then fail LINT "$n validate-policy 실패(rc=$RC): $(echo "$OUT" | first_line)"
  elif [[ "$OUT" == 0 ]]; then pass LINT "$n findings 0"
  else fail LINT "$n findings $OUT: $(lint "$n" 'findings[].[findingType,issueCode]' | tr '\t\n' '= ' | mask)"; fi
done

DONE=1
echo "== result: $([[ $FAILED == 1 ]] && echo FAIL || echo PASS) =="
exit $FAILED
