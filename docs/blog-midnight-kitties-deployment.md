# Midnight Kitties를 클론해서 배포하기까지 — 버전 지옥 삽질기

> "그냥 레포 클론해서 `yarn install` → `yarn build` → 배포하면 됩니다."
> 라고 적혀 있었지만, 실제로는 **빌드조차 안 됐다.** 컴파일러·런타임 버전 불일치,
> 죽어버린 테스트넷, Docker 타임아웃까지 — 컨트랙트 주소(CA) 하나 얻는 데 거친
> 전 과정을 기록한다.

대상 프로젝트: [riusricardo/midnight-kitties](https://github.com/riusricardo/midnight-kitties)
(Midnight 블록체인 + Compact 언어로 만든 CryptoKitties 스타일 NFT DApp)

목표: **NFT 컨트랙트를 배포하고 컨트랙트 주소를 얻기.**

---

## 0. 한 줄 요약

| 단계 | 증상 | 진짜 원인 | 처방 |
|---|---|---|---|
| 빌드 | `Cannot find module index.cjs`, `checkRuntimeVersion is not a function` | **컴파일러(0.31.0) ↔ 런타임(0.8.1) 버전 불일치** | 컴파일러 `0.24.0` 고정 |
| 프루프서버 | `Could not find a working container runtime strategy` | Docker Desktop 미실행 | Docker 켜기 |
| 지갑 | `Expected 32-byte seed` | seed가 64 hex가 아님 | 올바른 seed 입력/생성 |
| 네트워크 | `Timed out trying to connect` 무한 반복 | **testnet-02가 폐기됨(2026.02)** | 로컬 standalone 체인으로 전환 |
| 자동배포 | `Port 6300 not bound after 60000ms` | 프루프서버가 파라미터 다운로드에 ~90초 | 기동 대기 240초로 연장 |
| 펀딩 | 잔액 영원히 0 | genesis 민팅 주소가 network id에 따라 다름 | StandaloneConfig 경로 사용 |

최종 획득 CA(로컬 체인):
```
0200785a612f9d9f0eef51bfa93f36ba553054cc732b5036bf1d51cff88fb6d442cb
```

---

## 1. 빌드부터 깨진다 — 컴파일러 vs 런타임

`yarn build`를 돌리자 컨트랙트 컴파일은 되는데 타입체크에서 폭발한다.

```
error TS2307: Cannot find module './managed/kitties/contract/index.cjs'
```

컴파일러가 생성한 파일을 보니 `index.cjs`가 아니라 **`index.js`(ESM)**가 나와 있었다.
소스는 `.cjs`를 import하는데 말이다. `.js`로 바꿔봤더니 이번엔 런타임에서:

```
TypeError: __compactRuntime.checkRuntimeVersion is not a function
```

생성된 코드 첫 줄이 범인이었다.

```js
import * as __compactRuntime from '@midnight-ntwrk/compact-runtime';
__compactRuntime.checkRuntimeVersion('0.16.0');   // ← 이 함수가 런타임에 없다
```

확인해보니:

```bash
$ node -e "console.log(typeof require('@midnight-ntwrk/compact-runtime').checkRuntimeVersion)"
undefined          # compact-runtime 0.8.1 엔 이 함수가 없음
$ compact compile --version
0.31.0             # 설치된 컴파일러는 최신
```

**근본 원인:** 프로젝트는 `compact-runtime@0.8.1` / `midnight-js@2.0.2`라는 **testnet-02
시절 스택**에 묶여 있는데, 새 Compact 설치 스크립트가 **최신 컴파일러(0.31.0)**를 깔아버려서
서로 안 맞은 것. 새 컴파일러는 ESM `index.js` + `checkRuntimeVersion` 호출 코드를 뱉지만,
0.8.1 런타임엔 그 함수가 없다.

### 두 갈래

1. **앞으로(새 컴파일러에 맞춰 전부 업그레이드)** — SDK 메이저 버전 업, breaking change 다수.
2. **뒤로(런타임 0.8.1에 맞는 컴파일러로 고정)** — 자기완결적, stopgap.

배포가 목표라 **(2)**를 택했다. 어떤 컴파일러가 0.8.1과 맞는지 실험으로 찾았다.

```bash
$ compact update 0.24.0
$ compact compile +0.24.0 src/kitties.compact /tmp/out
# 결과: index.cjs (CommonJS!) + expectedRuntimeVersionString = '0.8.1' + checkRuntimeVersion 호출 없음
```

딱 맞는다. `package.json`의 compact 스크립트에 버전을 박았다.

```diff
- node ../../compact/src/run-compactc.cjs compile src/kitties.compact src/managed/kitties
+ node ../../compact/src/run-compactc.cjs compile +0.24.0 src/kitties.compact src/managed/kitties
```

`compact update 0.24.0` 한 번 + 재빌드 → **8/8 패키지 빌드 성공.**

> 교훈: Compact는 **컴파일러 버전과 런타임 패키지 버전이 한 쌍**이다. 설치 스크립트가 주는
> "최신"이 프로젝트가 핀한 SDK와 다르면 빌드부터 깨진다.

---

## 2. 프루프 서버는 Docker 컨테이너다

```bash
$ yarn kitties-cli-remote-ps
...
Error: Could not find a working container runtime strategy
```

`-ps`(proof server) 변형은 프루프 서버를 **로컬 Docker 컨테이너**(`midnightnetwork/proof-server`,
포트 6300)로 띄운다. 진단해보니 Docker Desktop 데몬 소켓이 없었다 — **그냥 Docker가 꺼져 있었다.**

```bash
$ open -a Docker      # 켜고 데몬 올라올 때까지 대기
```

---

## 3. 지갑 seed는 32바이트(64 hex)

```
Failed to build wallet from seed: Expected 32-byte seed
```

옵션 2(seed로 지갑)를 골랐는데 입력값이 64자리 hex가 아니었다. 버그가 아니라 정상 검증.
새 지갑(옵션 1)을 쓰거나, 올바른 seed를 만들면 된다.

```bash
$ openssl rand -hex 32     # 64자리 hex seed 생성
```

---

## 4. 진짜 벽 — 테스트넷이 죽어 있었다

지갑은 만들어졌는데 잔액이 0이고, 로그가 이 메시지만 반복했다.

```
Waiting for funds...
[] | Timed out trying to connect
```

faucet으로 채워도 소용없을 것 같아 네트워크를 의심했다. 찾아보니:

> **testnet-02는 2026년 2월에 폐기됐다.** 현재 개발 네트워크는 `preprod`.

프로젝트가 박아둔 엔드포인트가 죽은 거였다.

```ts
// TestnetRemoteConfig
indexer = 'https://indexer.testnet-02.midnight.network/...'   // ← 응답 없음
node    = 'https://rpc.testnet-02.midnight.network'           // ← 응답 없음
proofServer = 'http://127.0.0.1:6300'
```

| | testnet-02 (프로젝트) | preprod (현재) |
|---|---|---|
| 상태 | 폐기됨 (죽음) | 가동(불안정, 3/21 리셋 후) |
| midnight-js | 2.0.2 | **3.0.0** |
| wallet | 5.0.0 | **wallet-sdk 1.0.0** |
| Compact | 0.24.0 | **0.28.0** |
| proof-server | 4.0.0 | **7.0.0** |

preprod로 가려면 SDK 전체를 갈아엎어야 하고, 게다가 preprod 자체가 "안정 호환 매트릭스
나올 때까지 간헐적 불가용" 상태였다. 며칠짜리 작업 + 불확실. 그래서 **로컬 standalone 체인**으로
선회했다 — 핀된 스택 그대로, node+indexer+proof-server를 전부 로컬 Docker로 띄우고,
**genesis 블록이 미리 자금을 민팅해둔 시드**로 펀딩한다. faucet도 라이브 네트워크도 불필요.

```ts
// 로컬 dev 노드의 genesis 민팅 시드
const GENESIS_MINT_WALLET_SEED = '0000...0001';
// StandaloneConfig 일 때 자동 사용
```

---

## 5. 자동 배포의 잔펀치들

CLI는 대화형이라 자동화하면서 자잘하게 더 터졌다. 기록 차원에서 남긴다.

**(a) testcontainers 60초 타임아웃**
```
Error: Port 6300/tcp not bound after 60000ms
```
직접 컨테이너를 띄워 로그를 보니, 프루프 서버가 **기동 때마다 증명 파라미터(수십 MB)를
다운로드한 뒤에야 6300을 연다(~90초+).** 기본 60초 대기로는 부족했던 것. 레이스가 아니라
단순 시간 부족이었다.

```diff
- .withWaitStrategy('kitties-proof-server', Wait.forLogMessage('Actix runtime found...', 1))
+ .withWaitStrategy('kitties-proof-server', Wait.forListeningPorts().withStartupTimeout(240000))
```

**(b) `readline was closed`** — 입력을 한 번에 파이프하면 지갑 펀딩(비동기 대기) 전에 stdin이
EOF로 닫혀버린다. 그리고 readline은 **질문이 등록되기 전에 들어온 입력을 버린다.** 해결은
로그를 보고 프롬프트가 실제로 뜬 뒤에 FIFO로 입력을 흘려보내는 것.

```bash
mkfifo /tmp/cli_in
yarn run standalone < /tmp/cli_in > out.log &
exec 3>/tmp/cli_in
until grep -q "Deploy a new kitties contract" out.log; do sleep 2; done
echo 1 >&3        # 배포
until grep -qi "Contract Address" out.log; do sleep 2; done
echo 14 >&3       # 종료
```

**(c) 펀딩이 영원히 0** — `testnet-local`로 시도했더니 같은 시드인데 지갑 주소가 달랐다
(`...csr4vs4f` vs standalone `...csy9kffv`). genesis 민팅 자금은 **network id로 파생된 주소**로
들어가는데, `TestnetLocalConfig`와 `StandaloneConfig`의 network id가 달라 다른 주소가 나온
것. → `StandaloneConfig` 경로(`yarn run standalone`)를 써야 펀딩된다.

---

## 6. 배포 성공

```
Deploying kitties contract...
Deployed contract at address: 0200785a612f9d9f0eef51bfa93f36ba553054cc732b5036bf1d51cff88fb6d442cb
Contract Address: 0200785a...442cb
Total Kitties: 0
```

> 주의: 이 CA는 **로컬 체인** 위의 컨트랙트라 공개 익스플로러엔 안 보인다. "배포하고 주소
> 공유" 수준의 확인엔 충분하지만, 공개 네트워크 검증이 필요하면 preprod 이전이 필요하다.

---

## 7. 이미 올라와 있던 PR 두 개

같은 고생을 한 사람들이 있었다. 업스트림에 OPEN PR이 둘.

- **[#3 Fix compact compile and yarn build](https://github.com/riusricardo/midnight-kitties/pull/3)** —
  나와 **정반대 전략**. 새 컴파일러에 맞춰 `from`(예약어) 파라미터 rename + `.cjs`→`.js`.
  하지만 런타임 deps를 안 올려서 **배포 시 `checkRuntimeVersion` 크래시가 그대로 남고**,
  의존성 `midnight-contracts`의 `from`까지 고쳐야 하는 미완성. 빌드는 (부분) 통과, 배포는 미해결.
- **[#1 fix/yarn-install-errors](https://github.com/riusricardo/midnight-kitties/pull/1)** —
  Yarn 4 마이그레이션(+12836/−6664). `yarn install` 층위라 별개 문제.

두 PR 다 한동안 머지 안 된 상태. 그래서 이 글로 정리해 남긴다.

### 전략 비교

| | PR #3 (전진) | 이 글 (후진) |
|---|---|---|
| `from` 예약어 | 소스+의존성 rename 필요 | 0.24.0은 예약어 아님 → 불필요 |
| `.cjs/.js` | `.js`로 변경 | 0.24.0이 `.cjs` 생성 → 원본 유지 |
| 배포 런타임 크래시 | 남음 | 없음 |
| 실제 배포 | 미검증 | **성공(CA 획득)** |

---

## 8. 결론 — 재현 레시피

핀된 스택 그대로 **로컬에서 배포까지** 가는 최단 경로:

```bash
compact update 0.24.0                 # 런타임 0.8.1과 맞는 컴파일러 (한 번)
open -a Docker                        # Docker Desktop 켜기
yarn install && yarn build            # 8/8 통과
yarn --cwd packages/cli/kitties run standalone
# 메뉴에서 "1. Deploy a new kitties contract" → Contract Address 출력
```

바꾼 파일은 단 둘:
- `packages/contracts/kitties/package.json` — 컴파일러 `+0.24.0` 고정
- `packages/cli/kitties/src/standalone.ts` — 기동 대기 240초

**가장 큰 교훈:** 블록체인 SDK는 컴파일러·런타임·노드·인덱서·프루프서버·지갑이 한 세트로
버전이 맞물려 있고, 그중 하나(여기선 컴파일러)만 어긋나도 클론-빌드-배포 전체가 무너진다.
그리고 **테스트넷은 언젠가 죽는다** — 튜토리얼이 박아둔 엔드포인트를 항상 의심하라.

---

*Midnight 네트워크 상태 참고: [State of the Network (Feb 2026)](https://midnight.network/blog/state-of-the-network-february-2026),
[Preprod 상태](https://forum.midnight.network/t/preprod-preview-network-status/1094),
[faucet](https://midnight.network/test-faucet)*
