# Claude Ultimate Korean v4.8 - Enterprise Edition

> **상용화 수준의 완전한 AI 에이전트 - 212개 도구**
> **18개 게임 장르 + 46개 신기술 + 37개 마인크래프트 + 22개 Claude확장 + 5개 청크시스템**
> **한국어 자연어로 모든 기능 제어**
> **🆕 자동 스킬/플러그인 감지 - 작업에 필요한 기능 자동 감지 및 활성화**
> **🆕 컨텍스트 효율적 파일 읽기 - 대용량 파일 자동 분할 처리**
> **🆕 전문가 수준 PPT/학습자료 생성 - 세련된 디자인 자동 적용**

---

## 핵심 원칙

### 1. 치명적 오류 우선
모든 작업 전 무한 루프, 메모리 누수, 스택 오버플로우 스캔

### 2. 🆕 자동 대안 탐색 (2시간 막힘 방지)
```
⚠️ 같은 오류 3회 반복 감지 시:
   → 자동으로 다른 방법 제안
   → 5가지 대안 전략 순차 시도
   → 모든 전략 소진 시 근본적 재설계 권고
```

**트리거 키워드:**
- "막혀", "안풀려", "계속 오류", "똑같은 에러"
- "2시간째", "진행안됨", "다른 방법", "대안"

### 3. 필요한 기능만 로드
스마트 MCP 로더가 작업 분석 후 필요한 모듈만 활성화

### 4. 병렬 처리
독립 작업은 동시 실행으로 40-60% 시간 단축

### 5. 100% 완성 코드
TODO, PLACEHOLDER 없는 실제 작동 코드만 제공

---

## 🆕 v4.8 새 기능 - 자동 스킬/플러그인 감지 시스템

### 1. 자동 스킬 감지 (auto_skill_detector)

```
┌─────────────────────────────────────────────────────────────────┐
│  🔍 자동 스킬/플러그인 감지                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  작동 방식:                                                      │
│  ──────────                                                     │
│  1️⃣ 사용자 입력 분석                                            │
│     └─ 한국어/영어 키워드 패턴 매칭                              │
│                                                                 │
│  2️⃣ 필요 스킬 자동 감지                                         │
│     └─ 260+ 도구 중 관련 도구 식별                               │
│                                                                 │
│  3️⃣ 최적 도구 조합 추천                                         │
│     └─ 작업에 필요한 도구만 활성화                               │
│                                                                 │
│  4️⃣ 자동 실행 또는 확인 요청                                    │
│     └─ autoExecute 옵션으로 제어                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**사용 예시:**
```
"쇼핑몰 만들어줘"
→ 감지: fullstack_epct, payment_integration, auth, db
→ 자동 실행 또는 추천 목록 제공

"게임 만들어줘"
→ 감지: game_create, game_asset, game_balance, leaderboard
→ 최적 게임 개발 도구 조합 추천
```

### 2. 컨텍스트 효율적 읽기 (smart_context_reader)

```
┌─────────────────────────────────────────────────────────────────┐
│  📖 스마트 컨텍스트 리더                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  특징:                                                          │
│  ──────                                                         │
│  ✅ 한 번에 하나의 파일만 읽어 컨텍스트 절약                      │
│  ✅ 대용량 파일 자동 청크 분할 (기본 500줄)                       │
│  ✅ 관련 섹션 우선 읽기                                          │
│  ✅ 요약 모드로 전체 구조 파악                                   │
│                                                                 │
│  모드:                                                          │
│  ──────                                                         │
│  📄 full      - 전체 파일 (작은 파일용)                          │
│  📑 chunked   - 청크 단위 (대용량 파일용)                        │
│  📋 summary   - 요약만 (구조 파악용)                             │
│  🔍 relevant  - 관련 섹션만 (키워드 기반)                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**사용 예시:**
```
smart_context_reader({
  filePath: "src/index.ts",
  mode: "chunked",
  chunkSize: 500
})
→ 500줄씩 분할하여 순차 읽기
→ 컨텍스트 효율적 사용
```

### 3. 대용량 파일 자동 분할 (auto_file_splitter)

```
┌─────────────────────────────────────────────────────────────────┐
│  ✂️ 대용량 파일 자동 분할                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  분할 기준:                                                      │
│  ──────────                                                     │
│  📏 기본 500줄 초과 시 자동 분할                                  │
│  📏 maxLines 옵션으로 조정 가능                                   │
│                                                                 │
│  분할 전략:                                                      │
│  ──────────                                                     │
│  🔹 function  - 함수 단위 분할                                   │
│  🔹 class     - 클래스 단위 분할                                 │
│  🔹 logical   - 논리적 섹션 분할                                 │
│  🔹 equal     - 균등 분할                                        │
│                                                                 │
│  자동 처리:                                                      │
│  ──────────                                                     │
│  ✅ import/export 자동 관리                                      │
│  ✅ 의존성 분석 및 정리                                          │
│  ✅ index.ts 자동 생성                                           │
│  ✅ 순환 참조 방지                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**사용 예시:**
```
auto_file_splitter({
  filePath: "src/huge-file.ts",
  maxLines: 500,
  strategy: "logical"
})
→ 500줄 초과 파일 자동 분할
→ 관련 import/export 자동 관리
```

### 한국어 트리거

| 도구 | 한국어 트리거 |
|------|---------------|
| `auto_skill_detector` | "스킬 감지", "도구 추천", "뭐 필요해" |
| `smart_context_reader` | "파일 읽어", "코드 봐줘", "컨텍스트" |
| `auto_file_splitter` | "파일 분할", "나눠줘", "파일 너무 커" |

---

## 🔄 자동 대안 탐색 시스템 (v4.2 신규)

### 작동 방식
```
┌─────────────────────────────────────────────────────────────────┐
│  🔄 자동 대안 탐색                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1️⃣ 오류 시그니처 분석                                         │
│     └─ 유사 오류 자동 그룹화                                    │
│                                                                 │
│  2️⃣ 반복 감지 (3회 이상)                                       │
│     └─ 같은 방법으로 해결 안됨 → 경고                           │
│                                                                 │
│  3️⃣ 대안 전략 제시 (5단계)                                     │
│     └─ 이미 시도한 전략 제외                                    │
│                                                                 │
│  4️⃣ 전략 소진 시                                               │
│     └─ 근본적 재설계 권고                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 오류 타입별 대안 전략

| 오류 타입 | 전략 1 | 전략 2 | 전략 3 | 전략 4 | 전략 5 |
|----------|--------|--------|--------|--------|--------|
| **타입** | any 사용 | 타입 단언 | ?. ?? | 제네릭 단순화 | 인터페이스 재설계 |
| **빌드** | 캐시 삭제 | npm 재설치 | 버전 다운 | 설정 리셋 | 점진적 빌드 |
| **런타임** | ErrorBoundary | try-catch | fallback UI | lazy load | 기능 플래그 |
| **의존성** | --legacy-peer | --force | 대체 패키지 | 버전 고정 | 패치 |
| **일반** | 단순화 | 격리 | 재작성 | 스킵 | 롤백 |

### 사용 예시
```
"2시간째 같은 타입 오류야"
→ 자동으로 대안 전략 제시

"계속 빌드 에러 나는데 다른 방법 없어?"
→ 빌드 오류 대안 5가지 제시

"막혀서 진행이 안돼"
→ 현재 오류 분석 + 대안 전략 제안
```

---

## v4.1 새 기능 (40개 추가)

### 1. 게임 장르 (18개)

| 도구 | 설명 | 한국어 트리거 |
|------|------|---------------|
| `game_2d_create` | 2D 게임 (Phaser) | "2D게임", "플랫포머", "횡스크롤" |
| `game_3d_create` | 3D 게임 (Three.js) | "3D게임", "FPS", "TPS" |
| `game_trpg_create` | TRPG (테이블탑) | "TRPG", "D&D", "테이블탑" |
| `game_mmorpg_create` | MMORPG | "MMORPG", "MMO", "온라인RPG" |
| `game_shooter_create` | 슈팅 게임 | "슈팅", "탄막", "FPS" |
| `game_casual_create` | 캐주얼 게임 | "캐주얼", "하이퍼캐주얼", "미니게임" |
| `game_strategy_create` | 전략 시뮬레이션 | "전략", "RTS", "턴제" |
| `game_historical_create` | 역사 게임 | "삼국지", "역사", "전국시대", "조선" |
| `game_roguelike_create` | 로그라이크 | "로그라이크", "로그라이트", "던전" |
| `game_racing_create` | 레이싱 게임 | "레이싱", "드리프트", "카트" |
| `game_fighting_create` | 대전 격투 | "격투", "대전", "콤보" |
| `game_rhythm_create` | 리듬 게임 | "리듬", "음악", "비트" |
| `game_horror_create` | 호러 게임 | "호러", "공포", "서바이벌호러" |
| `game_sports_create` | 스포츠 게임 | "축구", "농구", "야구", "스포츠" |
| `game_visualnovel_create` | 비주얼 노벨 | "비주얼노벨", "연애시뮬", "스토리" |
| `game_survival_create` | 생존 게임 | "생존", "서바이벌", "배틀로얄" |
| `game_educational_create` | 교육용 게임 | "교육", "학습", "에듀테크" |
| `game_party_create` | 파티 게임 | "파티", "보드게임", "다인용" |

### 2. AI/ML 도구 (5개)

| 도구 | 설명 | 한국어 트리거 |
|------|------|---------------|
| `ai_chatbot_setup` | AI 챗봇 | "챗봇", "GPT", "Claude", "AI 대화" |
| `ai_image_setup` | AI 이미지 생성 | "이미지 생성", "DALL-E", "Stable Diffusion" |
| `ai_voice_setup` | AI 음성/TTS | "음성", "TTS", "STT", "클로바" |
| `ml_deploy_setup` | ML 모델 배포 | "모델 배포", "ML", "추론" |
| `rag_pipeline_setup` | RAG 파이프라인 | "RAG", "벡터DB", "임베딩" |

### 3. 블록체인/Web3 (4개)

| 도구 | 설명 | 한국어 트리거 |
|------|------|---------------|
| `web3_wallet_setup` | Web3 지갑 연동 | "지갑", "메타마스크", "Web3" |
| `nft_marketplace_setup` | NFT 마켓플레이스 | "NFT", "민팅", "마켓플레이스" |
| `smart_contract_setup` | 스마트 컨트랙트 | "스마트컨트랙트", "솔리디티", "컨트랙트" |
| `defi_integration_setup` | DeFi 통합 | "DeFi", "스왑", "스테이킹" |

### 4. AR/VR/메타버스 (3개)

| 도구 | 설명 | 한국어 트리거 |
|------|------|---------------|
| `webxr_setup` | WebXR 설정 | "VR", "AR", "XR", "WebXR" |
| `metaverse_setup` | 메타버스 플랫폼 | "메타버스", "가상공간", "아바타" |
| `model_viewer_setup` | 3D 모델 뷰어 | "3D뷰어", "모델뷰어", "GLTF" |

### 5. IoT/엣지 (3개)

| 도구 | 설명 | 한국어 트리거 |
|------|------|---------------|
| `iot_platform_setup` | IoT 플랫폼 | "IoT", "센서", "디바이스" |
| `smarthome_setup` | 스마트홈 | "스마트홈", "홈오토메이션", "Matter" |
| `edge_computing_setup` | 엣지 컴퓨팅 | "엣지", "에지컴퓨팅", "Cloudflare Workers" |

### 6. 실시간/협업 (3개)

| 도구 | 설명 | 한국어 트리거 |
|------|------|---------------|
| `realtime_collab_setup` | 실시간 협업 | "협업", "동시편집", "Liveblocks" |
| `video_conference_setup` | 화상회의 | "화상회의", "비디오콜", "WebRTC" |
| `push_notification_setup` | 푸시 알림 | "푸시", "알림", "FCM" |

### 7. 기타 신기술 (6개)

| 도구 | 설명 | 한국어 트리거 |
|------|------|---------------|
| `lowcode_builder_setup` | 로우코드 빌더 | "로우코드", "노코드", "드래그앤드롭" |
| `microservices_setup` | 마이크로서비스 | "마이크로서비스", "MSA" |
| `serverless_setup` | 서버리스 | "서버리스", "람다", "Edge Functions" |
| `data_pipeline_setup` | 데이터 파이프라인 | "ETL", "데이터파이프라인", "Kafka" |
| `multitenancy_setup` | 멀티테넌시 | "멀티테넌시", "SaaS 아키텍처" |
| `security_platform_setup` | 보안 플랫폼 | "SIEM", "SOC", "보안플랫폼" |

---

## v4.0 기능 (상용화 도구 22개)

### 1. 인프라/DevOps (6개)

| 도구 | 설명 | 한국어 트리거 |
|------|------|---------------|
| `cicd_setup` | CI/CD 파이프라인 | "파이프라인", "CI/CD", "자동화 배포" |
| `monitoring_setup` | 모니터링 시스템 | "모니터링", "센트리", "데이터독" |
| `logging_setup` | 로그 관리 | "로그", "ELK", "키바나" |
| `infra_as_code` | Terraform/Pulumi | "테라폼", "인프라", "IaC" |
| `k8s_setup` | Kubernetes | "쿠버네티스", "k8s", "클러스터" |
| `load_balancer` | 로드 밸런싱 | "로드밸런서", "스케일링" |

### 2. 보안 (6개)

| 도구 | 설명 | 한국어 트리거 |
|------|------|---------------|
| `security_audit` | 보안 감사 | "보안 검사", "취약점", "감사" |
| `waf_setup` | WAF 설정 | "WAF", "방화벽", "웹방화벽" |
| `ddos_protection` | DDoS 방어 | "DDoS", "디도스", "공격 방어" |
| `compliance_check` | 컴플라이언스 | "GDPR", "SOC2", "PCI", "컴플라이언스" |
| `pentest_setup` | 침투 테스트 | "펜테스트", "침투", "모의해킹" |
| `secret_manager` | 시크릿 관리 | "시크릿", "비밀키", "암호 관리" |

### 3. 결제/비즈니스 (5개)

| 도구 | 설명 | 한국어 트리거 |
|------|------|---------------|
| `payment_integration` | 결제 통합 | "결제", "스트라이프", "토스페이먼츠" |
| `subscription_system` | 구독 관리 | "구독", "요금제", "플랜" |
| `accounting_integration` | 세금/회계 | "세금", "회계", "인보이스" |
| `support_system` | 고객 지원 | "고객지원", "티켓", "채팅" |
| `analytics_setup` | 분석 시스템 | "분석", "GA", "믹스패널" |

### 4. 게임 특화 (6개)

| 도구 | 설명 | 한국어 트리거 |
|------|------|---------------|
| `game_server` | 멀티플레이어 서버 | "게임 서버", "멀티플레이어", "소켓" |
| `anticheat_system` | 안티 치트 | "안티치트", "치트 방지", "핵 방지" |
| `game_qa` | QA 자동화 | "게임 QA", "밸런스 테스트" |
| `leaderboard_system` | 리더보드 | "리더보드", "순위", "랭킹" |
| `asset_pipeline` | 에셋 파이프라인 | "에셋", "스프라이트", "텍스처" |
| `ingame_shop` | 인게임 상점 | "상점", "아이템", "가챠" |

---

## 한국어 자연어 패턴 (3000+)

### 게임 장르
```
"삼국지 게임 만들어줘" → game_historical_create
"MMORPG 만들어줘" → game_mmorpg_create
"2D 플랫포머 만들어줘" → game_2d_create
"3D FPS 만들어줘" → game_3d_create
"로그라이크 던전 게임" → game_roguelike_create
"리듬 게임 만들어줘" → game_rhythm_create
"비주얼 노벨 만들어줘" → game_visualnovel_create
"배틀로얄 만들어줘" → game_survival_create
```

### AI/ML
```
"챗봇 만들어줘" → ai_chatbot_setup
"이미지 생성 AI 붙여줘" → ai_image_setup
"RAG 파이프라인 구축해줘" → rag_pipeline_setup
"음성 인식 추가해줘" → ai_voice_setup
```

### Web3/블록체인
```
"지갑 연동해줘" → web3_wallet_setup
"NFT 마켓 만들어줘" → nft_marketplace_setup
"스마트 컨트랙트 작성해줘" → smart_contract_setup
```

### AR/VR
```
"VR 앱 만들어줘" → webxr_setup
"메타버스 공간 만들어줘" → metaverse_setup
"3D 모델 뷰어 추가해줘" → model_viewer_setup
```

### 인프라/DevOps
```
"CI/CD 설정해줘" → cicd_setup
"모니터링 붙여줘" → monitoring_setup
"쿠버네티스로 배포해줘" → k8s_setup
```

### 보안
```
"보안 검사해줘" → security_audit
"WAF 설정해줘" → waf_setup
"GDPR 준수 확인해줘" → compliance_check
```

### 결제
```
"결제 붙여줘" → payment_integration
"구독 시스템 만들어줘" → subscription_system
```

---

## 기존 도구 (60개)

### 코어
- `korean_natural` - 한국어 자연어 처리
- `critical_first` - 치명적 오류 우선 감지
- `fullstack_epct` - 풀스택 EPCT 생성
- `deep_thinking` - 5단계 심층 분석

### 개발
- `scaffold` - 프로젝트 스캐폴딩
- `component_generator` - 컴포넌트 생성
- `api_generator` - API 라우트 생성
- `seed_generator` - 시드 데이터 생성

### UI/UX
- `elegant_ui` - 세련된 UI
- `asset_generator` - 파비콘/OG 이미지
- `name_generator` - SaaS 이름 생성

### 배포/테스트
- `auto_deploy` - 자동 배포
- `browser_test` - 브라우저 테스트
- `performance_profiler` - 성능 프로파일링

### 게임
- `game_create` - 게임 프로젝트 생성
- `game_complete` - 게임 완전 자동화
- `game_scenario` - 시나리오 작성
- `game_asset` - 에셋 설정
- `game_balance` - 밸런스 설계

### 문서
- `ppt_creator` - PPT 생성
- `learning_material` - 학습 자료 생성
- `document_generator` - 문서 생성

### 검증
- `verify` - 교차 검증 (5개+ 소스)
- `verify_enhanced` - 강화된 검증

---

## 도구 사용 예시

### 삼국지 스타일 역사 게임
```
game_historical_create(
  projectName: "삼국영웅전",
  subGenre: "삼국지",
  style: "koei-style",
  scale: "strategic",
  features: ["dynasty", "generals", "diplomacy", "economy", "battle"]
)
```

### MMORPG
```
game_mmorpg_create(
  projectName: "환상대륙",
  subGenre: "fantasy",
  maxPlayers: 1000,
  features: ["class-system", "guild", "raid", "pvp", "crafting", "housing"]
)
```

### AI 챗봇
```
ai_chatbot_setup(
  provider: "openai",
  model: "gpt-4o",
  features: ["streaming", "memory", "rag"]
)
```

### NFT 마켓플레이스
```
nft_marketplace_setup(
  blockchain: "ethereum",
  features: ["minting", "auction", "royalties", "lazy-mint"]
)
```

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│               Claude Ultimate MCP v4.8 (212개 도구)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Core      │  │  Game Genre │  │  SaaS Tech  │             │
│  │  (60개)     │  │  (18개)     │  │  (46개)     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Minecraft   │  │ Claude확장  │  │  청크시스템  │             │
│  │  (37개)     │  │  (22개)     │  │  (5개)      │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  ┌─────────────────────────────────────────────────┐           │
│  │           한국어 자연어 패턴 매칭                 │           │
│  │               (3000+ 패턴)                       │           │
│  └─────────────────────────────────────────────────┘           │
│                                                                 │
│  ┌─────────────────────────────────────────────────┐           │
│  │      🆕 전문가 PPT/학습자료 자동 생성 시스템       │           │
│  └─────────────────────────────────────────────────┘           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 환경 변수

```bash
# 데이터베이스
DATABASE_URL="postgresql://..."

# 인증
NEXTAUTH_SECRET="..."
NEXTAUTH_URL="http://localhost:3000"

# AI/ML
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
PINECONE_API_KEY="..."

# 결제
STRIPE_SECRET_KEY="sk_..."
STRIPE_PUBLISHABLE_KEY="pk_..."
TOSS_CLIENT_KEY="..."
TOSS_SECRET_KEY="..."

# Web3
ALCHEMY_API_KEY="..."
WALLETCONNECT_PROJECT_ID="..."

# 모니터링
SENTRY_DSN="..."
DATADOG_API_KEY="..."

# 인프라
AWS_ACCESS_KEY_ID="..."
AWS_SECRET_ACCESS_KEY="..."
VERCEL_TOKEN="..."
```

---

## 라이선스

MIT
