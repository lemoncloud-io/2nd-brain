---
type: tool
topics:
  - aws-serverless
status: draft
sources:
  - "https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html"
  - "https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html"
  - "https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html"
  - "https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html"
  - "https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html"
  - "https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html"
  - "https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html"
  - "https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-bucket-encryption.html"
  - "https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html"
  - "https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html"
  - "[[projects/aws-serverless/README|aws-serverless]]"
created: "2026-10-06"
updated: "2026-10-06"
---

# Amazon S3

## Summary

Amazon S3 는 파일을 **객체(object)** 로 저장하는 오브젝트 스토리지다. 객체는 파일 데이터와 그 파일을 설명하는 메타데이터
(`Content-Type`, 수정 시각 등)로 이뤄지고, **버킷(bucket)** 이라는 컨테이너에 들어간다. 버킷 안에서 객체를 가리키는 이름이
**키(key)** 이고, 버킷 + 키 + (버저닝을 켰다면) 버전 ID 조합이 객체 하나를 가리킨다.

- **키는 경로가 아니다.** S3 는 평평한 구조다. `자료/설비/a.json` 의 `자료/설비/` 는 키 이름의 일부(접두어)이고, 콘솔이 폴더처럼
  보여 줄 뿐이다. 키는 UTF-8 기준 최대 1,024 바이트이고 대소문자를 구분한다.
- **버킷 이름은 기본적으로 전역에서 유일해야 한다**(같은 파티션의 모든 계정·리전 통틀어). 이름과 리전은 만든 뒤 바꿀 수 없다.

이 파이프라인에서 S3 는 **원본 보관소이자 처리의 시작점**이다. 파일을 올리면 `ObjectCreated` 이벤트가 Lambda ingest 를 깨우고,
그 결과가 DynamoDB 한 행(PK `docId` = S3 키, SK `version` = S3 versionId)이 된다. 원본 파일은 S3 에 그대로 남는다.

### 버저닝과 versionId

버킷은 세 상태 중 하나다: 버저닝 없음(기본) · 켜짐 · 일시 중지. **한 번 켜면 "없음"으로 돌아갈 수 없고 일시 중지만 된다.**
켜진 버킷에 같은 키로 다시 올리면 덮어쓰지 않고 새 버전이 생기며, S3 가 버전마다 고유한 version ID 를 만든다. 삭제하면 객체 대신
delete marker 가 현재 버전이 된다. 버저닝을 켜기 전부터 있던 객체의 version ID 는 `null` 이다. 버전 하나하나가 차분이 아닌
객체 전체라서, 세 버전이 있으면 객체 세 개분 저장 요금이 붙는다.

파이프라인의 `version` 값이 바로 이 versionId 다. 이벤트의 `s3.object.versionId` 를 그대로 쓰고, 없으면 문자열 `"null"` 을 넣는다
(`stack1-ingest/src/transform.ts` `NO_VERSION`). 그래서 같은 파일을 다시 올리면 **행이 하나 더** 생겨 이력이 남는다. 버저닝을 끈
버킷이면 같은 키가 계속 `"null"` 이라 조건부 쓰기 때문에 두 번째 업로드는 건너뛴다(처음 내용이 이긴다 — README § 설계 근거).

### 이벤트 알림 (ObjectCreated → Lambda)

버킷에 알림 설정을 붙이면 지정한 이벤트를 SNS·SQS·Lambda·EventBridge 로 보낸다. `s3:ObjectCreated:*` 는 객체를 만든 API
(Put·Post·Copy·CompleteMultipartUpload)를 가리지 않고 받는 와일드카드다. AWS 문서 기준으로 알아 둘 동작:

- **최소 한 번(at least once) 전달.** 보통 몇 초 안에 오지만 1분 이상 걸릴 수도 있고, 드물게 같은 이벤트가 두 번 온다.
- **순서 보장 없음.** 같은 키의 이벤트 순서는 `sequencer` 값을 비교해서만 알 수 있다.
- **키는 URL 인코딩돼서 온다**(`red flower.jpg` → `red+flower.jpg`). ingest 는 `+` 를 공백으로 바꾼 뒤 `decodeURIComponent` 로 되돌린다.
- **재귀 루프 경고.** 알림을 받은 함수가 같은 버킷에 다시 쓰면 자기 자신을 또 부른다. 버킷을 나누거나 입력용 접두어에만 트리거를 건다.

### 퍼블릭 액세스 차단과 기본 암호화

퍼블릭 액세스 차단은 설정 네 개(`BlockPublicAcls` · `IgnorePublicAcls` · `BlockPublicPolicy` · `RestrictPublicBuckets`)로 ACL·버킷
정책을 통한 공개를 막는다. 조직·계정·버킷·액세스 포인트 수준에 걸 수 있고, 값이 다르면 **가장 엄격한 조합**이 적용된다. 계정 수준
설정은 모든 리전에 적용된다(반영 시차는 있을 수 있다). 버킷 정책을 바꿀 수 있는 사람은 버킷 수준 차단도 풀 수 있기 때문에, AWS 는
`BlockPublicPolicy` 를 계정 수준에 두라고 권한다.

기본 암호화: 2023-01-05 부터 새로 올리는 모든 객체는 추가 비용 없이 SSE-S3(`AES256`)로 자동 암호화된다. SSE-KMS·DSSE-KMS 를
기본값으로 고를 수도 있지만 KMS 요금과 KMS 요청 한도가 따라온다. 기본 암호화를 바꿔도 이미 있던 객체는 그대로다.

### 수명주기 규칙 (보관 기간)

Lifecycle 규칙은 다른 스토리지 클래스로 옮기는 **전환(transition)** 과 지우는 **만료(expiration)** 를 한다. 버저닝 버킷에서
`Expiration` 은 현재 버전에만 작용해 delete marker 를 올릴 뿐이고, 이전(noncurrent) 버전을 실제로 지우려면
`NoncurrentVersionExpiration` 을 따로 건다. 이렇게 지운 버전은 복구할 수 없다. 삭제는 비동기라 시차가 있지만 만료 이후 저장 요금은 붙지 않는다.

## Use Cases

- **원본 보관** — 흩어진 파일을 한 버킷에 모은다. 버저닝 덕에 덮어쓰거나 지워도 이전 버전을 되살릴 수 있다.
- **처리 트리거** — 업로드가 곧 신호다. 서버 없이 `ObjectCreated` 이벤트가 [[wiki/aws-lambda|AWS Lambda]] 를 부른다.
- **재처리** — 스택보다 먼저 올린 파일은 이벤트가 없다. 같은 키로 다시 올리면 새 버전과 함께 이벤트가 생긴다.
- **파일 하나 = 행 하나** — CSV 줄을 행으로 펼치지 않는다. 256 KB 이하 `application/json` 만 본문을 `data` 로 인라인한다.

## Setup Notes

설치 절차는 스킬에 있다. 여기에는 이 파이프라인의 설정값만 적는다(`projects/aws-serverless/config/sam/stack1-ingest/template.yaml`).

| 항목 | 이 파이프라인의 값 |
|---|---|
| 버킷 이름 | `<스택명>-data-<계정ID>` (순환 참조를 피하려고 고정) |
| 버킷 수준 퍼블릭 차단 | `PublicAccessBlockConfiguration` 네 값 모두 `true` |
| 기본 암호화 · 버저닝 | SSE-S3 (`SSEAlgorithm: AES256`) · `Enabled` |
| 버킷 정책 | `DenyInsecureTransport` — `aws:SecureTransport` 가 `false` 인 요청 거부(TLS 전용, `http://` 는 403 실측) |
| 이벤트 | `s3:ObjectCreated:*` → `IngestFunction`, 접두어·접미어 필터 없음 |
| ingest 의 S3 권한 | `s3:GetObject` · `s3:GetObjectVersion` 읽기만 — 같은 버킷에 쓰지 않아 재귀 루프가 없다 |
| 수명주기 규칙 | **템플릿에 없다.** 스킬은 "30일 뒤 이전 버전 삭제"를 걸 수 있다고만 적는다 |

- **계정 수준 퍼블릭 차단은 계정 관리자가 켠다.** 신규 계정에는 설정 자체가 없었고(`NoSuchPublicAccessBlockConfiguration`, 실측),
  배포 키(`sls-deployer`)는 `SlsGuardDeny` 가 `s3:PutAccountPublicAccessBlock` 을 막아 끌 수 없다. SAM 이 버킷 정책을 써야 해서
  버킷 수준 공개 경로는 배포 키 정책으로 못 막으므로, 계정 수준 차단이 그 문이다. `verify.sh` V9 가 확인한다
  ([[projects/aws-serverless/guides/policy-design|policy-design]]).
- 버저닝 버킷은 `sam delete` 로 바로 지워지지 않는다. 버전과 delete marker 를 먼저 비운다(aws-s3-ingest § 철거).
- 배포·스모크·진단: [[projects/aws-serverless/config/skills/aws-s3-ingest|aws-s3-ingest]] ·
  빌드·롤백: [[projects/aws-serverless/config/skills/aws-lambda-deploy|aws-lambda-deploy]] ·
  계정 수준 차단 켜기: [[projects/aws-serverless/config/skills/aws-account-setup|aws-account-setup]].

## Related Concepts

- [[wiki/serverless-data-pipeline|Serverless Data Pipeline]] — S3 가 첫 단계인 전체 흐름.
- [[wiki/aws-lambda|AWS Lambda]] — `ObjectCreated` 를 받는 ingest 함수. 비동기 호출이라 실패는 재시도 2회 뒤 DLQ 로 간다.
- [[wiki/aws-dynamodb|Amazon DynamoDB]] — S3 키·versionId 가 `docId`·`version` 이 된다. at-least-once 중복은 조건부 쓰기가 흡수한다.
- [[wiki/aws-iam|AWS IAM]] — 버킷 정책(리소스 기반)과 실행 role(자격 증명 기반). 계정 수준 차단이 배포 키 밖에 있는 이유.
- [[wiki/aws-sam|AWS SAM]] — 버킷·알림·권한을 한 템플릿으로 만든다. 콘솔에서 지운 알림 설정은 재배포로 복구한다.

## Open Questions

- AWS 는 버저닝을 처음 켠 뒤 15분 기다렸다 쓰라고 권한다. 스택 생성 직후 업로드에서 versionId 가 비어 `"null"` 행이 생길 수 있는지 `미검증`.
- 수명주기 규칙이 없어 이전 버전이 계속 쌓인다. 며칠 뒤 지울지, 그때 DynamoDB 이력 행도 정리할지 정해지지 않았다.
- ingest 는 `ObjectRemoved` 를 무시한다. 원본을 지웠을 때 검색에서도 빠져야 하는지 결정되지 않았다.
