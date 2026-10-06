---
type: concept
topics:
  - aws-serverless
status: draft
sources:
  - "[[projects/aws-serverless/README|aws-serverless]]"
  - "[[projects/devops/README|devops]]"
  - "[[projects/aws-serverless/guides/as-is-to-be|As-Is/To-Be 양식]]"
created: "2026-10-06"
updated: "2026-10-06"
---

# 서버리스 데이터 파이프라인

## Summary

파일이 들어올 때마다 자동으로 처리·저장·색인하는 구조를 서버 없이 AWS 관리형 서비스로 엮은 패턴이다.
원본은 먼저 [[wiki/aws-s3|Amazon S3]]에 올리고, 업로드 이벤트로 [[wiki/aws-lambda|AWS Lambda]]가 돌아
[[wiki/aws-dynamodb|Amazon DynamoDB]]에 저장한다. 검색·집계가 필요하면 DynamoDB Stream을 받아
[[wiki/aws-opensearch-serverless|Amazon OpenSearch Serverless]]에 색인한다. 실행 가능한 레퍼런스는
[[projects/aws-serverless/README|aws-serverless]] 프로젝트에 있다.

```
원본 데이터 → S3 업로드 → (ObjectCreated) Lambda ingest → DynamoDB (PK=docId, SK=version)
                                                        └ Stream → Lambda index → OpenSearch Serverless
```

## Details

### 단계별 역할

| 단계 | 서비스 | 하는 일 |
|---|---|---|
| 원본 보관 | [[wiki/aws-s3\|S3]] | 들어온 파일을 그대로 보관. 처리의 시작점이자 재처리의 원천 |
| 처리 | [[wiki/aws-lambda\|Lambda]] ingest | 업로드 이벤트마다 실행. 메타데이터·본문을 행으로 바꾼다 |
| 저장 | [[wiki/aws-dynamodb\|DynamoDB]] | 키로 바로 꺼내는 저장소. 같은 (docId, version)은 한 번만 쓴다 |
| 색인 | Lambda index → [[wiki/aws-opensearch-serverless\|OpenSearch Serverless]] | Stream 배치마다 `_bulk` 1회. 검색·집계·시계열 질의 |
| 배포 | [[wiki/aws-sam\|AWS SAM]] | 스택 2개(저장·전처리 / 색인)로 나눠 배포·철거 |
| 권한 | [[wiki/aws-iam\|AWS IAM]] | 정책 3개로 묶은 배포 키로만 배포. 관리자 키를 쓰지 않는다 |

### 왜 서버리스인가

- **켜 두는 서버가 없다.** 요청·실행 시간·저장량에 비례해 낸다. 서버(EC2) 구성은 로드밸런서·인스턴스·디스크가
  쓰지 않는 시간에도 과금된다.
- **예외가 하나 있다.** OpenSearch Serverless는 컬렉션이 있는 동안 시간당 고정비가 붙는다. 검색·집계가 필요 없으면
  DynamoDB까지만 쓰고, 필요할 때만 색인 스택을 올린다.
- **건수가 적으면 두 구성의 비용 차이는 작을 수 있다**(추정). 그래서 구성을 고르기 전에 데이터 양부터 적는다 — 아래 § 비용 추정에 필요한 값.

### 설계에서 지키는 것

- **멱등** — 행의 키는 S3 키와 versionId이고, 조건부 쓰기로 같은 행을 두 번 쓰지 않는다. 색인 `_id`도 같은 값이라 재색인해도 중복이 생기지 않는다.
- **실패를 버리지 않는다** — 처리 실패는 재시도 후 SQS DLQ로 보내고, DLQ 깊이 알람을 건다. Stream은 보존 기간이 지나면 사라지므로
  DynamoDB를 다시 읽어 색인하는 재색인 절차를 둔다.
- **최소 권한** — 배포 키는 파이프라인 서비스만 만지고, Lambda 실행 역할에는 권한 상한을 씌운다.
  설계 근거: [[projects/aws-serverless/guides/policy-design|정책 설계 근거]].

### 비용 추정에 필요한 값

[[projects/aws-serverless/guides/as-is-to-be|As-Is/To-Be 양식]]의 데이터 현황 칸이 이 값들이다.

| 값 | 무엇에 쓰나 |
|---|---|
| 시간당(또는 하루) 건수 | Lambda 실행 횟수, DynamoDB 쓰기 횟수 |
| 건당 원본 크기 | S3 저장량, Lambda 실행 시간 |
| 검색에 남길 크기와 보관 기간 | OpenSearch 저장량과 필요한 OCU |
| 조회 빈도 | 검색 OCU, DynamoDB 읽기 |

## Connections

- 개발 작업에서 이 패턴으로 오는 길: [[projects/devops/README|devops]] — 로컬 작업과 서버리스 작업을 먼저 가른다.
- 실행: [[projects/aws-serverless/README|aws-serverless]] — 계정 준비 → 배포 키 → 검증 → 스킬 순서대로 배포.
- 서비스별 개념: [[wiki/aws-s3|Amazon S3]] · [[wiki/aws-lambda|AWS Lambda]] · [[wiki/aws-dynamodb|Amazon DynamoDB]] ·
  [[wiki/aws-opensearch-serverless|Amazon OpenSearch Serverless]] · [[wiki/aws-iam|AWS IAM]] · [[wiki/aws-sam|AWS SAM]]

## Open Questions

- 업무 API(API Gateway), 일정 실행(EventBridge), 대시보드는 이 패턴의 범위 밖이다. 필요해지면 별도 패턴으로 다룬다.
- 레코드 여러 개를 한 파일로 묶어 보내는 소스는 레코드 단위로 펼치는 파서가 따로 필요하다.
