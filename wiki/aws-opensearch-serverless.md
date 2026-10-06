---
type: tool
topics:
  - aws-serverless
status: draft
sources:
  - "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-overview.html"
  - "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-comparison.html"
  - "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-create.html"
  - "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-scaling.html"
  - "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-scale-to-zero.html"
  - "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-security.html"
  - "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-encryption.html"
  - "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-network.html"
  - "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-data-access.html"
  - "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-genref.html"
  - "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-clients.html"
  - "https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-dashboards.html"
  - "https://docs.aws.amazon.com/opensearch-service/latest/ServerlessAPIReference/API_CreateCollection.html"
  - "[[projects/aws-serverless/README|aws-serverless]]"
  - "[[projects/aws-serverless/config/skills/aws-opensearch|aws-opensearch]]"
created: "2026-10-06"
updated: "2026-10-06"
---

# Amazon OpenSearch Serverless

## Summary

Amazon OpenSearch Serverless 는 Amazon OpenSearch Service 의 서버리스 판이다. 클러스터·노드를 만들고 조정하는 일이 없다. 색인과 검색을 받는 단위는 **컬렉션**(collection)으로, 한 워크로드를 위해 함께 쓰는 인덱스 묶음이다.
색인용 연산과 검색용 연산이 분리돼 있고, 인덱스의 기본 저장소는 Amazon S3 다. 연산 용량은 OCU(OpenSearch Compute Unit)로 잰다. 1 OCU 는 메모리 6 GiB 와 그에 맞는 vCPU, S3 전송을 묶은 단위이며 색인 OCU 와 검색 OCU 를 따로 잡는다.

이 파이프라인에서 OpenSearch 는 **질의 전용 사본**이다. 원본은 DynamoDB 이고, 컬렉션을 지워도 테이블에서 재색인해 되살릴 수 있다. DynamoDB 는 키로만 찾으므로 전문 검색·집계·시계열 질의는 여기서 한다.

### 컬렉션 유형

유형은 만들 때 고르고 나중에 바꿀 수 없다. API 값은 `SEARCH | TIMESERIES | VECTORSEARCH` 다.

| 유형 | 용도 | 저장 | 제약 |
|---|---|---|---|
| Search (`SEARCH`) | 전문 검색 | 전부 hot | 사용자 지정 문서 ID 가능. k-NN 인덱스 불가 |
| Time series (`TIMESERIES`) | 로그 분석 같은 기계 생성 시계열 | 최근은 hot, 나머지 warm | 사용자 지정 문서 ID 색인·upsert 불가. k-NN 불가 |
| Vector search (`VECTORSEARCH`) | 임베딩 기반 의미 검색 | 전부 hot | 사용자 지정 문서 ID 불가 |

AWS 문서의 API 표를 보면 `PUT <index>/_doc/<id>`·`_create/<id>`·`_update/<id>` 는 Search 유형 전용이다. 지금 문서는 세대를 NextGen(컬렉션 그룹, scale to zero)과 Classic 으로 나누며, Time series 는 Classic 에만 있다.

**이 파이프라인이 SEARCH 를 고른 이유**(README § 설계 근거): TIMESERIES 는 사용자 지정 `_id`·업데이트를 받지 않아 DynamoDB 의 MODIFY/REMOVE 를 반영하지 못한다. 색인 문서의 `_id` 는 `docId#version` 이어서 재색인을 여러 번 돌려도 결과가 같다(멱등). 시계열 질의는 SEARCH 컬렉션에 `@timestamp` 필드를 두어 해결한다(원천 필드는 `TimestampField` 파라미터, 기본값 `eventTime`).

### 과금 구조와 고정비

- 청구 항목은 색인 연산 OCU-시간, 검색 연산 OCU-시간, S3 에 보관한 스토리지다(AWS 문서 비교표).
- scale to zero(유휴 10분 뒤 0 OCU)는 **컬렉션 그룹에 속한 NextGen 컬렉션에만** 있다. 이 파이프라인의 컬렉션은 그룹 없이 만들어지므로 대상이 아니다. 그래서 컬렉션은 **존재만으로 OCU 과금**이 나고, 이 파이프라인에서 유일한 고정비다.
- 서울 OCU 단가는 시간당 **USD 0.293**(색인·검색 같음, 실측)이다. 월 추정과 경우별 표는 [[projects/aws-serverless/config/skills/aws-opensearch|aws-opensearch]] § 비용 한곳에만 둔다.
- 템플릿은 `StandbyReplicas: DISABLED` 다. 템플릿 주석은 이 설정이 최소 OCU 청구를 절반으로 줄인다고 적는다.

### 계정 수준 용량 상한

- 컬렉션 그룹 없이 만든 Classic 컬렉션은 계정 수준 용량 설정을 따른다. 바꾸는 명령은 `update-account-settings` 다.
- 콘솔에서 최대 인덱싱·검색 OCU 로 고를 수 있는 최솟값은 2, 기본값은 10 이다(스킬 § 비용, 09-24 실측). 이 값은 **용량 상한**이고 과금 최소 단위와 다르다.
- 컬렉션 그룹은 자체 최소·최대를 갖는다(콘솔에서 새 그룹을 만들 때 최대 기본값 96). 계정 상한은 그룹에 속하지 않은 컬렉션에만 적용되므로, 그룹을 쓰면 용량이 계정 상한 밖에서 정해진다(스킬 § 비용).
- 용량 사용량은 계정 수준 CloudWatch 지표 `IndexingOCU`·`SearchOCU` 로 본다.

### 보안 정책 3종

컬렉션이 동작하려면 암호화 키, 네트워크 접근 설정, 맞는 데이터 접근 정책이 모두 있어야 한다.

| 정책 | 정하는 것 | 알아 둘 점 |
|---|---|---|
| 암호화 (`encryption`) | AWS 소유 키 또는 고객 관리형 KMS 키 | 저장 데이터 암호화는 필수다. 컬렉션을 만든 뒤에는 키를 바꿀 수 없고, 바꾸려면 컬렉션을 다시 만든다. 한 컬렉션은 암호화 정책 하나에만 맞는다 |
| 네트워크 (`network`) | public 또는 private(OpenSearch Serverless 관리형 VPC 엔드포인트, Amazon Bedrock 같은 AWS 서비스). 리소스 유형 `collection`·`dashboard` 를 따로 지정 | 문법 필드는 `AllowFromPublic`·`SourceVPCEs`·`SourceServices` 다. 문서의 문법 표에 IP·CIDR 필드는 없다. public 이어도 데이터 접근은 데이터 접근 정책이 막는다 |
| 데이터 접근 (`data`) | 규칙(리소스 유형 `collection`/`index`, 리소스 패턴, 권한)과 주체(IAM 사용자·역할, SAML) | 주체는 같은 계정이어야 한다. 명시 거부가 없고 권한은 합산된다. 생성 후 적용까지 약 1분, 수정은 몇 분 지연될 수 있다 |

데이터 접근 정책만으로는 데이터에 닿지 않는다. 주체는 IAM 권한 `aoss:APIAccessAll`·`aoss:DashboardsAccessAll` 도 함께 가져야 하고, 없으면 403 이 난다(AWS 문서). 제어 평면 API(`CreateCollection` 등)는 IAM 이, 데이터 평면 OpenSearch API(`PUT <index>` 등)는 데이터 접근 정책이 다룬다.

### `_bulk` 색인과 SigV4

- OpenSearch API 요청은 SigV4 로 서명한다. 서비스 이름은 `aoss` 이고 관리형 도메인의 `es` 와 다르다. 다른 클라이언트로 직접 서명할 때는 `x-amz-content-sha256` 헤더가 필수다.
- `POST _bulk` 와 `DELETE <index>/_doc/<id>` 는 데이터 접근 권한 `aoss:WriteDocument` 에 속한다. 인덱스 refresh 주기는 약 10초이고 바꿀 수 없다.
- 이 파이프라인의 index 함수는 `@opensearch-project/opensearch` 의 `AwsSigv4Signer`(`service: 'aoss'`)를 쓴다. 스트림 배치(최대 100건)마다 `_bulk` 를 1번 호출한다. INSERT/MODIFY 는 `_id = docId#version` 으로 색인하고 REMOVE 는 같은 `_id` 를 삭제한다. 응답의 `errors` 에서 항목 오류가 나오면 예외를 던져 bisect·재시도·DLQ 로 넘긴다.

### 대시보드 접근

대시보드 URL 형식은 `https://dashboards.<region>.aoss.amazonaws.com/_login/?collectionId=<id>` 다. 콘솔에 로그인한 상태로 열면 자동으로 로그인되고, 세션 제한 시간은 1시간이며 바꿀 수 없다. 데이터 접근 정책이 있어야 열리고, 네트워크 정책에 `dashboard` 리소스 유형이 허용돼 있어야 한다.

## Use Cases

- 문서 검색: 정확 일치는 `term` 질의로, 한글 전문 검색은 `.text` 서브필드의 `match` 질의로 한다.
- 집계: 그룹별 건수와 평균을 `size: 0` 으로 집계 결과만 받는다. AI 에게 인사이트 질의를 만들게 할 때 쓰는 틀은 스킬 § 질의 패턴에 있다.
- 시계열: `@timestamp` 기준 `date_histogram`. 원천 필드를 바꾸지 않으면 한 번에 올린 과거 로그가 업로드 시각으로 몰린다.
- 쓰지 않는 경우: 키 조회만 필요하면 DynamoDB 만으로 충분하다. 이때는 고정비가 없는 스택 ①만 남긴다.

## Setup Notes

설치 절차는 스킬에 있다. 여기는 이 파이프라인에서 어떻게 설정돼 있는지만 적는다(`projects/aws-serverless/config/sam/stack2-index/template.yaml`).

- 리소스 순서: `EncryptionPolicy`(`<CollectionName>-enc`, `AWSOwnedKey: true`) → `NetworkPolicy`(`<CollectionName>-net`, collection·dashboard `AllowFromPublic: true`) → `Collection`(`Type: SEARCH`, `StandbyReplicas: DISABLED`) → `DataAccessPolicy`(`<CollectionName>-data`, index·collection 에 `aoss:*`).
- 데이터 접근 주체는 index 함수 role 과 `QueryPrincipalArns` 파라미터(계정 관리자 `admin-<이름>` + `sls-deployer`)다. 함수 role 에는 SAM `Policies` 로 컬렉션 ARN 에 대한 `aoss:APIAccessAll` 을 준다.
- `CollectionName` 은 3~26자, 소문자·숫자·하이픈이다. 보안 정책 이름에 `-data` 가 붙어도 32자 안이어야 하기 때문이다.
- VPC 엔드포인트는 `ec2:*` 가 필요한데 배포 키가 거부하므로 network 는 public 으로 둔다. 접근은 IAM SigV4 와 데이터 접근 정책으로 막는다.
- 컬렉션 생성은 실측 3.5분(09-23)이 걸렸고 최대 15분을 잡는다. Outputs 는 `CollectionEndpoint`·`DashboardEndpoint` 다.
- 계정 용량 상한 2 는 계정 관리자가 콘솔에서 건다([[projects/aws-serverless/config/skills/aws-account-setup|aws-account-setup]] 6번). 배포 키는 `aoss:UpdateAccountSettings`·`aoss:CreateCollectionGroup`·`aoss:UpdateCollectionGroup` 이 거부다.
- 첫 컬렉션을 만들 때 서비스 연결 role `AWSServiceRoleForAmazonOpenSearchServerless` 가 생긴다. 배포 키 정책은 이 role 하나만 예외로 허용한다.
- 배포·질의·재색인·매핑 변경·철거 절차는 [[projects/aws-serverless/config/skills/aws-opensearch|aws-opensearch]], 스트림·DLQ 쪽은 [[projects/aws-serverless/config/skills/aws-dynamodb-stream|aws-dynamodb-stream]] 에 있다.

## Related Concepts

- [[wiki/serverless-data-pipeline|서버리스 데이터 파이프라인]] — 이 서비스가 놓이는 전체 흐름
- [[wiki/aws-dynamodb|Amazon DynamoDB]] — 원본 테이블과 Stream
- [[wiki/aws-lambda|AWS Lambda]] — Stream 을 받아 `_bulk` 를 호출하는 index 함수
- [[wiki/aws-iam|AWS IAM]] — `aoss:*` IAM 권한, 서비스 연결 role, 배포 키 정책
- [[wiki/aws-sam|AWS SAM]] — 스택 ② 배포 도구

## Open Questions

- 복제본을 끈 컬렉션의 최소 과금 단위(스킬 표의 색인 0.5 + 검색 0.5)는 이번에 연 AWS 문서에서 다시 확인하지 못했다(`미검증`). 09-23 CloudWatch 지표는 IndexingOCU 1.0·SearchOCU 1.0 이었다. 어느 줄로 청구되는지는 첫 달 청구서로 확정한다(스킬 § 비용).
- AWS 문서는 데이터 접근에 `aoss:APIAccessAll`·`aoss:DashboardsAccessAll` 이 **둘 다** 필요하다고 적는다. 그런데 템플릿의 함수 role 은 `aoss:APIAccessAll` 만 받는다. 실측에서 색인이 통과한 것과 이 문구가 어떻게 맞는지는 `미검증`.
- README 는 TIMESERIES 가 "삭제"도 지원하지 않는다고 적는다. AWS 문서 표에서 Search 전용으로 표시된 것은 사용자 지정 ID 쓰기(`PUT _doc/<id>`·`_create`·`_update`)이고, `DELETE <index>/_doc/<id>` 에는 그 표시가 없다. README 문구를 고쳐야 하는지 확인 필요.
- NextGen 컬렉션 그룹의 scale to zero 를 쓰면 유휴 고정비가 없어진다. 하지만 배포 키는 컬렉션 그룹 생성을 거부하고(계정 상한 우회 방지), 템플릿도 그룹을 쓰지 않는다. 이 선택을 다시 볼지는 열려 있다.
- AWS 문서는 그룹 없는 Classic 컬렉션끼리 같은 KMS 키를 쓰면 OCU 를 공유한다고 적는다. 같은 AWS 소유 키로 컬렉션을 하나 더 만들면 고정비가 늘지 않는지는 `미검증`.
- 스택을 삭제한 뒤 과금이 몇 분 안에 멈추는지는 `미검증`(스킬 § 철거).
