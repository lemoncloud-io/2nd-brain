---
title: "드디어 나에게 딱 맞았던 AI 에이전트 설정: Hermes + OpenAI Codex + Claude Code"
source: "https://www.reddit.com/r/hermesagent/comments/1t9chdk/the_ai_agent_setup_that_finally_clicked_for_me/?tl=ko"
author:
  - "[[kenduffy]]"
published: 2026-05-11
created: 2026-07-02
description: "팀처럼 실제로 작동하는 멀티 에이전트 AI 워크플로우 구축 드디어 챗봇 루프가 아닌 진짜 팀처럼 느껴지는 AI 설정이 작동하게 됐어요. 혹시 다른 분들께 도움이 될까 해서 공유합니다. 제 OpenAI 인증 로그인으로 He"
tags:
  - "clippings"
---
==드디어 챗봇 루프가 아닌 진짜 팀처럼 느껴지는 AI 설정이 작동하게 됐어요. 혹시 다른 분들께 도움이 될까 해서 공유합니다.==

==제 OpenAI 인증 로그인으로 Hermes를 실행하려고 할 때 계속 막혔어요. 토큰당 비용을 지불하고 싶지 않았고, 제 ChatGPT Pro 구독도 몇 시간 동안 많이 사용하면 속도가 느려지더라고요. 코딩 세션에는 Claude를 선호하지만 Hermes에 OAuth로 연결할 수 없는 Claude Max 플랜도 가지고 있어요. 그래서 하나의 모델을 메인 슬롯에 억지로 넣으려고 하는 대신 역할을 분담하기로 했어요. 이 설정이 흐름을 해결했고, 솔직히 Claude를 메인 두뇌로 사용하는 것보다 더 잘 작동해요.==

==**스택:**==

- ==항상 켜져 있는 코디네이터로서의 **Hermes 에이전트**==
- ==메인 Hermes 두뇌로서의 **OpenAI Codex**==
- ==제 Claude 구독을 사용하는 별도의 코딩 전문가로서의 **Claude Code**==
- ==어디서든 시스템에 접근할 수 있도록 인터페이스로서의 **Telegram**==
- ==파일, cron, 이메일, 쉘, Home Assistant 등을 위한 제 컴퓨터의 **로컬 도구**==

==**사고방식의 전환:**==

==하나의 채팅 창 안에서 하나의 모델이 모든 것을 하도록 만들려고 하지 마세요.==

==Hermes는 오케스트레이터로서 훌륭해요. 메모리, 도구, 예약된 작업, 메시징을 보유하고 있으며 실제로 컴퓨터에서 작업을 수행할 수 있어요. 이메일을 보내고, 스크립트를 실행하고, 파일을 확인하고, Telegram으로 소통하고, cron을 관리하고, 작업을 조정해요.==

==Claude Code는 집중된 코딩 작업자로 훌륭해요. 이미 Claude를 구독하고 있기 때문에 Anthropic API 크레딧을 소모하지 않고 Claude Code를 사용할 수 있어요. Hermes는 터미널에서 Claude Code를 호출하고, 제한된 코딩 작업을 전달하고, 결과를 읽고, 변경 사항을 확인하고, 보고해요.==

==OpenAI Codex는 일반적인 앞뒤 조정 및 도구 사용을 포함하여 메인 Hermes 에이전트 측면을 잘 처리해요.==

==**워크플로우:**==

1. ==제가 Hermes에게 원하는 것을 말해요.==
2. ==Hermes는 직접 처리할지 아니면 Claude Code에 코딩 부분을 위임할지 결정해요.==
3. ==Claude Code가 코드를 작성, 검토 또는 수정해요.==
4. ==Hermes가 결과를 확인하고, 간단한 테스트를 실행하고, 시스템에 연결하고, 보고해요.==

==이것은 성능이 떨어지는 하드웨어에서 로컬 LLM을 실행하는 것보다 훨씬 잘 작동해요. 저는 Ollama를 로컬에서 시도해봤어요. 기술적으로는 작동했지만, 전체 에이전트 사용에는 너무 느렸어요.==

==더 나은 방법은 로컬 모델에 모든 것을 하도록 강요하는 것을 멈추고 각 역할에 가장 적합한 도구를 사용하는 것이었어요:==

- ==**Hermes**: 오케스트레이터 및 자동화 계층==
- ==**OpenAI Codex**: 메인 에이전트 모델==
- ==**Claude Code**: 구독 기반 코딩 전문가==
- ==**로컬 머신**: 실행 환경==
- ==**Telegram**: 원격 제어 인터페이스==

==이것으로 실제 작동하는 설정을 얻게 되었어요. 다음과 같은 말을 할 수 있어요:==

==그러면 시스템이 직접 실행할 지침 목록을 주는 대신 도구 전반에 걸쳐 작업을 수행해요.==

==**이미 가지고 있다면:**==

- ==작고 항상 켜져 있는 Linux 박스, 미니 PC, NUC 또는 서버==
- ==Claude 구독==
- ==OpenAI Codex 액세스==
- ==약간의 터미널 설정에 익숙하다면==

==이 패턴을 시도해보세요.==

==정신적인 전환:==

- ==Hermes를 관리자로 사용하세요.==
- ==Claude Code를 전문가로 사용하세요.==
- ==Codex를 메인 에이전트 두뇌로 사용하세요.==
- ==그 모든 것을 대체하기 위해 작은 로컬 모델을 만들려고 시간을 낭비하지 마세요.==

==실용적인 개인 운영 시스템처럼 느껴지는 첫 번째 AI 설정이에요. 참신한 것 이상으로요.==

==편집 (2026년 5월 14일): Anthropic은 이번 주에 2026년 6월 15일부터 claude -p 및 Agent SDK 사용이 Claude 구독 풀에서 분리된다고 발표했어요. 각 티어는 API 요금으로 청구되는 별도의 월별 크레딧(Pro $20, Max 5x $100, Max 20x $200)을 받으며, 이월되지 않아요. 터미널에서의 대화형 Claude Code는 구독에 유지돼요. 프로그래밍 방식(-p, SDK, GitHub Actions, 타사 하네스)은 모두 새로운 크레딧 풀로 이동해요.==

==또한 일부 사용자에게는 ANTHROPIC\_API\_KEY가 설정되지 않은 상태에서도 claude -p 헤드리스 모드가 Max 구독 대신 API 요금으로 자동 전환되는 알려진 버그가 있어요. 이 설정을 실행 중이라면 claude /status를 실행하고 echo $ANTHROPIC\_API\_KEY를 확인하여 실제로 어떤 경로가 활성화되어 있는지 확인하세요.==

==결론적으로, 아래 Hermes에서 claude -p를 사용하는 패턴은 여전히 작동하지만, 만료일이 있어요. 6월 15일 이후에는 해당 호출이 새로운 크레딧 버킷에 대해 측정돼요. 저는 가능한 경우 대화형 tmux 세션을 사용하도록 설정을 재작업 중이며, 어떤 것이 유지되는지 테스트한 후 후속 게시물을 올릴 거예요. 컨텍스트를 위해 원본 게시물은 그대로 둘 거예요.==

Read more

---

## Comments

> **Far\_Jeweler1975** · [2026-05-10](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/ol1fxin/?tl=ko) · 4 points
> 
> 그래서 클로드 프로 20달러 플랜을 쓰고 있는데... 20달러 내고 Chatgpt쓰고 텔레그램도 설정했거든. 좀 바보 같은 질문일 수도 있는데, 플랜에 포함된 것보다 돈을 너무 많이 쓰거나 토큰을 더 많이 쓰는 건 아닌지 어떻게 확인해야 해?
> 
> 완전 초보야.
> 
> > **kenduffy** · [2026-05-10](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/ol26bem/?tl=ko) · 11 points
> > 
> > 전혀 이상한 질문 아니에요, 제일 먼저 물어봐야 할 질문이죠. 제가 토큰 비용 안 내는 방법은 이래요:
> > 
> > - **ChatGPT Pro (20달러)**: 저는 제 Pro 구독을 통해 OpenAI OAuth로 Hermes를 실행해요. API 키도 없고, 토큰당 요금도 없어요. 많이 쓰면 속도 제한이 걸리긴 하지만, 돈은 안 나가요.
> > - **Claude Max 플랜 (100달러)**: 이 플랜으로 Claude Code의 강력한 코딩 능력을 구독해서 쓸 수 있어요. Hermes는 CLI를 통해 Claude Code로 넘어가고, Claude Code는 제 Max 구독으로 인증해요. 이것도 마찬가지로 API 비용이 안 들어요.
> > 
> > 그래서 이 모든 게 두 개의 정액제 구독으로 돌아가요. 토큰당 과금되는 건 아무것도 없어요. 최악의 경우엔 하나가 잠시 저를 제한했다가 다시 풀리는 거죠.
> > 
> > 피해야 할 건 Hermes를 OpenAI API 키나 Anthropic API에 직접 연결하는 거예요. 거기서부터 요금이 부과되기 시작해요. 양쪽 모두 OAuth/구독 인증을 유지하는 한, 정액제예요.
> > 
> > 어쨌든 안전하게 쓰는 습관 하나: 혹시라도 어떤 이유로든 API 키를 추가하게 된다면, 먼저 해당 제공업체의 결제 대시보드에 들어가서 월별 최대 사용 금액을 딱 정해두세요. 싼 보험이죠.

> **dweebikus** · [2026-05-10](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/ol132yi/?tl=ko) · 8 points
> 
> 네 에이전트가 넘어지면서 머리를 부딪혀서 계속 똑같은 말을 반복하고 있어. 그래도 접근 방식은 탄탄했어.
> 
> > **kenduffy** · [2026-05-10](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/ol13qxe/?tl=ko) · 3 points
> > 
> > 오케스트레이터가 자체 출시 발표문을 쓰게 놔둔 대가죠 뭐.

> **dalemugford** · [2026-05-10](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/ol1t68y/?tl=ko) · 4 points
> 
> 구독으로 클로드 코드 위임은 어떻게 하신 거예요? 커스텀 래퍼/스킬 쓰신 건가요?
> 
> > **kenduffy** · [2026-05-10](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/ol2a3ub/?tl=ko) · 9 points
> > 
> > 래퍼 없이 그냥 서브프로세스 호출만 해요. Hermes는 `claude` CLI로 바로 셸 아웃해요:
> > 
> > claude -p "여기에 작업" --max-turns 10
> > 
> > Claude Code는 제 Max 서브에 대해 자체 OAuth를 처리하므로 Hermes는 Anthropic API를 전혀 건드리지 않아요. Anthropic 쪽에서는 제가 터미널에서 명령어를 입력하는 것과 똑같이 보여요.
> > 
> > 이걸 설정할 때 주의할 점이 하나 있어요: Hermes에서 관리하는 Node는 `~/.hermes/node/bin/claude`에 바이너리를 떨어뜨리는데, 이게 기본적으로 PATH에 없어요. 저는 이걸 bashrc에 추가하고 `~/.local/bin/` 으로 심볼릭 링크해서 Hermes가 깔끔하게 찾을 수 있도록 했어요.
> > 
> > 더 긴 세션의 경우엔 tmux로 들어가서 Hermes가 모니터링하는 동안 Claude를 인터랙티브하게 실행해요. 잘 작동해요.

> **fredastere** · [2026-05-11](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/ol3o3r2/?tl=ko) · 5 points
> 
> 응 나도 거의 똑같이 해!
> 
> 나도 프로필을 사용하고 에이전트 간 통신을 구현했어
> 
> 항상 살아있게 하고 싶은 에이전트들은 세션을 시작하거나 재개할 수 있는 워커 서비스가 연결되어 있어
> 
> 내가 다른 점은 오퍼스 코드를 안 쓴다는 거야 ㅋㅋ!
> 
> 그리고 헤르메스가 직접 클로드 -p 명령어를 쓰도록 해서 안전하게 서브를 사용할 수 있게 했어.
> 
> 두 가족 모두 계획하고 있는데, 오퍼스 4.7로 수렴 패스를 거치고 gpt5.5가 최종 합성을 하도록 할 거야.
> 
> 이 계획은 TDD + JiT + 수직 슬라이스 원칙으로 구현될 거야.
> 
> 오퍼스 4.7이 다음 청크를 정의하고, gpt5.5가 청크를 구현하고, 소넷 4.6이 빠르게 검토해. 한 단계 또는 마일스톤의 모든 청크에 대해 반복하고 나면 gpt5.5가 전체 마일스톤을 QA 검토할 거야.
> 
> 반복하면 돼.
> 
> UI만 예외인데, 오퍼스가 구현하고 gpt5.5가 검토해 :3

> **cata\_stropheu** · [2026-05-10](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/ol165ke/?tl=ko) · 1 points
> 
> 칸반 보드로 똑같은 걸 시도하고 있었어요. 어떻게 사용하는지에 대한 더 구체적인 내용이 궁금하네요.

> **FourMonthsEarly** · [2026-05-10](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/ol1d069/?tl=ko) · 1 points
> 
> 클로드 코드를 제3자 오케스트레이터랑 같이 못 쓰는 줄 알았는데?
> 
> > **kenduffy** · [2026-05-10](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/ol25avs/?tl=ko) · 3 points
> > 
> > 클로드 코드 자체가 네 구독에 인증된 거야. 이 설정에서는 허메스가 앤트로픽 API랑 전혀 통신하지 않아. 그냥 다른 터미널 명령어처럼 `claude` CLI로 빠져나가는 거지. 앤트로픽 입장에서는 내가 터미널에서 직접 `claude -p "task"` 를 입력하는 거랑 똑같아.
> > 
> > 네가 할 수 없는 건 네 클로드 구독을 허메스가 API로 직접 호출하는 모델 제공자로 사용하는 거야. 그건 맞아. 하지만 클로드 코드 CLI를 서브프로세스로 실행하는 건 괜찮아.

> **Akolite** · [2026-05-10](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/ol1ni50/?tl=ko) · 1 points
> 
> 오케스트레이터로 어떤 모델을 사용해? 나도 NUC랑 맥에서 비슷한 설정을 하고 있거든. NUC를 오케스트레이터로 설정했는데, 거기에 프로필 4개를 설정했고 NUC에도 똑같이 설정했어. 각 프로필마다 다른 모델을 설정했지. 나는 codex를 ChatGPT 20달러 구독이랑 Openrouter를 사용해서 deepseek랑 Gemini를 써. 한 달에 20달러 크레딧으로. 가끔 모든 걸 ChatGPT 5.5에서 실행하고 작업을 오프로드하지 않아서 라우팅 로직을 좀 손봐야 했어. 그래도 괜찮은 워크플로우를 만들었지. 메인 오케스트레이션 모델로는 뭘 사용하는지 궁금했어.

> **hesalop** · [2026-05-10](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/ol2cnqh/?tl=ko) · 1 points
> 
> Claude Code 대신 Codex를 호출하는 OpenAI 구독 하나만 사용하면 안 돼?

> **AbjectBug5885** · [2026-05-11](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/ol5j58h/?tl=ko) · 1 points
> 
> 텔레그램을 인터페이스로 쓰는 건 저평가된 것 같아. Claude 코드 핸드오프-커스텀 스킬이 API 래퍼로 나가거나, 더 깔끔한 방식으로 처리되는 건 어떻게 하고 있어?

> **Repair\_\_** · [2026-05-11](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/ol6r574/?tl=ko) · 1 points
> 
> 이게 바로 멀티 에이전트 설정이 실제로 작동하게 만드는 거예요! 많은 사람들이 하나의 모델이 모든 걸 다 하도록 만들려고 하다가 문제가 생기면 불평하거든요. 흥미로운 점은 Hermes의 스킬 시스템이 시간이 지남에 따라 패턴을 학습하기 시작한다는 거예요. 충분한 Hermes-Claude 코드 검증 사이클을 거치면 코딩 작업을 언제, 어떻게 라우팅해야 하는지에 대한 스킬을 구축하게 되고, 이건 즉, 실행 시간이 길어질수록 훨씬 빨라진다는 뜻이죠.
> 
> > **kenduffy** · [2026-05-14](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/oltug7a/?tl=ko) · 1 points
> > 
> > 응, 싱글 모델 함정이 대부분 사람들을 막는 거야.

> **saltySprinkle** · [2026-05-12](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/olfwvr2/?tl=ko) · 1 points
> 
> 클로드 코드 구독을 허메스랑 같이 쓰면, 허메스가 API 호출에 허메스라고 참조를 남겨서 클로드에서 그래도 API 호출로 요금을 청구한다는 얘기를 들었어.
> 
> > **kenduffy** · [2026-05-14](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/oltuzhm/?tl=ko) · 1 points
> > 
> > 응... 누가 커밋 메시지에 "HERMES.md"가 있어서 API 요금 200달러가 청구된 documented case가 있는데, 앤트로픽 백엔드에서 이걸 제3자 하네스 사용으로 플래그했대.
> > 
> > 알아둬야 할 두 가지 빌링 이스케이프 해치는 -p 헤드리스 버그랑, 페이로드에 있는 하네스 시그니처가 분류기를 트리핑하는 거야. 둘 다 API로 조용히 라우팅돼.
> > 
> > 오늘 밤: claude /status, platform.claude.com에서 예상치 못한 API 사용량 확인, Claude Code가 업스트림에서 보는 모든 것에 "Hermes" 문자열이 있는지 프로젝트 파일 스캔.

> **Pixel23** · [2026-05-14](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/olt2b5j/?tl=ko) · 1 points
> 
> 야, 이거 올려줘서 고마워. 3일 전에 설정했는데 지금까지 꽤 잘 작동하고 있어. ChatGPT의 속도 제한에 걸린 후에 백업 LLM을 로드할 수 있을까? 어젯밤에 걸렸는데 이제 주간 제한이 초기화될 때까지 4일 동안 잠겨버렸어. 만약 가능하다면 DeepSeek 같은 백업 모델을 추천해 줄 수 있을까, 아니면 다른 거라도. 고마워.
> 
> > **kenduffy** · [2026-05-14](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/oltqrdf/?tl=ko) · 1 points
> > 
> > 잘 작동한다니 다행이네. 4일간 잠기는 건 좀 힘들겠지만, 뭐, 챗 사용량보다 허미스가 주간 한도를 더 빨리 소진할 수 있지, 도구 오버헤드 때문에. 나도 아직 백업을 직접 설정해본 적은 없어서 경험상 추천은 못 하겠네. 백업 레이어로 오픈 라우터를 보고, 모델로는 딥시크나 제미니 2.5 플래시를 생각하고 있어. 둘 다 엄청 싸. 오픈 라우터 크레딧 10달러면 꽤 오래 쓸 수 있을 거야. 이 스레드에 다른 댓글 단 사람도 대충 그 조합으로 한 달에 총 20달러 정도 쓰고 있대. 일단 수동으로 전환하고, 백업 모델이 믿을 만해지면 나중에 자동 장애 조치로 넘어가.

> **Sarkisi2** · [2026-05-16](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/om24z4a/?tl=ko) · 1 points
> 
> Hermes가 OpenClaw보다 낫다고 생각해?
> 
> > **kenduffy** · [2026-05-16](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/om2o0a3/?tl=ko) · 1 points
> > 
> > 오픈클로를 드디어 은퇴시키고 각자 기계에 헤르메스 에이전트 두 개를 두니 더 좋네.

> **RecognitionHot9149** · [2026-05-24](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/onmil93/?tl=ko) · 1 points
> 
> 혹시 앤트로픽이 프로그래밍 사용 관련해서 업데이트한 후에, 터미널에서 -p 없이 Hermes랑 Claude 같이 쓰는 방법 알아냈어?
> 
> > **kenduffy** · [2026-05-24](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/onosoq3/?tl=ko) · 1 points
> > 
> > 응, hermes로 tmux 세션 실행해서 거기서 관리하고 있어.

> **CCR\_OUTBets123** · [2026-05-27](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/oo3br5n/?tl=ko) · 1 points
> 
> 야, 잠깐 질문 있어. 혹시 텔레그램은 메시지를 계속 받는데 모델이 'NoneType' object is not iterable 오류 뜨면서 멈추는 Hermes/OpenAI Codex 제공자 오류 겪어본 적 있어? 맥락: Hermes Agent + Telegram OpenAI Codex 제공자 API 키 설정 안 함 ( ChatGPT/Codex 인증 흐름 사용) 오늘 아까까진 완벽하게 작동했는데, 갑자기 오류가 나기 시작했어 openai- 응답이 알 수 없는 제공자로 표시됨 openai- codex는 인증은 성공하는데 추론에서 멈춤 이게 다음 중 어떤 건지 파악 중이야: 최근 Codex 백엔드/제공자 회귀 문제인지, 잘못된 모델 ID 문제인지, 아니면 Hermes 제공자 호환성 문제인지. 너도 비슷한 거 겪은 적 있어?
> 
> > **kenduffy** · [2026-05-29](https://reddit.com/r/hermesagent/comments/1t9chdk/comment/oohayjh/?tl=ko) · 1 points
> > 
> > 그건 아마 헤르메스 버그일 거예요. 그냥 업데이트하세요. 이미 수정되었어요.