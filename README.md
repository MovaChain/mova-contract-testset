# EVM Compatibility Test Suite

## Overview

This suite provides end-to-end smart-contract compatibility tests for **EVM-compatible chains**, including chains built with go-ethereum or compatible implementations. Its primary purpose is to verify that a target chain correctly implements EIPs introduced across the London/Berlin through Prague and Osaka rule sets, and that modern Solidity contract patterns work correctly on-chain.

Typical use cases:

- **EVM upgrade validation**: Run the suite before and after a ruleset upgrade and compare behavior.
- **New-chain launch checks**: Verify that the chain's EVM implementation conforms to Ethereum specifications.
- **Compatibility regression testing**: Run it in continuous integration to prevent node iterations from regressing EVM behavior.

The suite verifies the following areas:

1. New opcodes and precompiles introduced by EIPs (including PUSH0, TLOAD/TSTORE, MCOPY, CLZ, and P256VERIFY) behave correctly on the real block-execution path.
2. Security rules (EIP-3541, EIP-3860, and EIP-6780) are enforced correctly.
3. Failed-transaction gas refund semantics are correct (`revert` charges only `gasUsed`; OOG charges the full amount).
4. Modern contract standards and ecosystem interfaces (OZ 5.6 ERC-20/721/1155/2612, Chainlink AggregatorV3, Uniswap v4 PoolKey/StateLibrary, CREATE2, proxies, ECDSA, Multicall, and more) deploy and execute correctly.
5. Block environment values (BASEFEE, PREVRANDAO, timestamp, and more) are injected with the correct on-chain values.

---

## Test Methodology: Write Transactions, Then Read State

Every test follows the same process to cover the **real block-execution path**, not the simulated `eth_call` path:

```
1. Send a state-changing transaction (sendTransaction)
      ↓ Execute the EVM feature under test and write the result to contract storage
2. Wait for the transaction to be mined (waitForDeployment / receipt)
      ↓
3. Call a view getter and assert that the result matches the expected value
```

`eth_call` does not pass through the state machine of consensus/sync nodes, so many injected values (such as BASEFEE and PREVRANDAO) can be zero on that simulated path. A state-changing transaction must pass through the complete block-execution flow, exposing differences between actual node behavior and the specification.

**Helper utilities (`test/_helpers.js`)**:

- `writeCall(contract, signer, method, args, gasLimit)` — Sends a state-changing transaction to a contract and returns its receipt. It explicitly sets `gasLimit` to bypass `estimateGas`, which is particularly important for transactions expected to revert.
- `sendRaw(signer, txReq)` — Sends a low-level transaction and returns its receipt whether it succeeds or reverts.
- `sendRawLarge(txReq)` — Handles the special case of oversized initcode (≥32 KB), bypassing Hardhat's internal restriction and extending the HTTP timeout.

---

## Contracts and Tests

### Part 1: EVM Instruction-Set Upgrade Validation (EIP Features)

These tests target the boundary behavior of each EIP directly. Minimal probe contracts exercise the relevant instructions and verify that the node implements the EIP semantics correctly.

---

#### 01 — PUSH0 (EIP-3855)

**Contract** `contracts/Push0Probe.sol`
**Test** `test/01-push0.test.js`

**Purpose**: Verify that an upgraded node recognizes and executes the `0x5F` (PUSH0) opcode correctly. PUSH0 pushes the constant zero onto the stack and is among the most basic bytecode emitted by Solidity 0.8.20+ compilers. Before the upgrade, a node rejects contracts containing this opcode with an invalid-opcode error; after the upgrade, it should execute successfully and write the result (zero) to storage.

---

#### 02 — Transient Storage: TLOAD/TSTORE (EIP-1153)

**Contract** `contracts/TransientProbe.sol`
**Test** `test/02-transient.test.js`

**Purpose**: Verify the three core properties of transient storage:

- **Round trip**: A value written with TSTORE can be read back with TLOAD during the same transaction.
- **Cleared between transactions**: Reading the same slot in the next transaction returns zero because transient storage is not persisted.
- **Revert rollback**: A TSTORE write is reverted when its transaction reverts.

Transient storage is a foundational primitive for patterns such as reentrancy locks and flash loans, so all three properties are essential.

---

#### 03 — Memory Copy: MCOPY (EIP-5656)

**Contract** `contracts/McopyProbe.sol`
**Test** `test/03-mcopy.test.js`

**Purpose**: Verify that the `MCOPY` opcode correctly copies arbitrary byte sequences in EVM memory and follows the specification when the source and destination overlap. Solidity compilers emit this instruction for internal array and string operations, making it necessary for modern contracts to function correctly.

---

#### 04 — Block Environment Variables (EIP-3198 / EIP-4399 / Other)

**Contract** `contracts/BlockEnvProbe.sol`
**Test** `test/04-blockenv.test.js`

**Purpose**: Systematically verify the actual on-chain values of all block-level environment variables available to a contract:

| Variable | Expected behavior |
|----------|-------------------|
| `block.basefee` | EIP-3198: nonzero after the upgrade and consistent with the chain's configured fee rate. |
| `block.prevrandao` | EIP-4399: a non-deterministic value that changes across blocks. Its source differs by chain implementation, for example LastCommitHash or a VDF. |
| `block.number` | Monotonically increasing and nonzero. |
| `block.timestamp` | Monotonically increasing Unix timestamp in seconds. |
| `block.gaslimit` | Consistent with the chain's configured gas limit. |
| `block.chainid` | Consistent with the configured network `chainId` in `hardhat.config.js`. |
| `block.coinbase` | Miner/validator address. Some consensus implementations, such as Tendermint, do not map the proposer, in which case this is `address(0)`; this is a chain-level implementation difference. |
| `tx.gasprice` | Consistent with the transaction's actual `gasPrice`. |

---

#### 05 — EOF Format Rejection (EIP-3541)

**Contract** `contracts/Eip3541Probe.sol`
**Test** `test/05-eip3541.test.js`

**Purpose**: Verify that a node rejects deployment of bytecode starting with `0xEF` as runtime code. EIP-3541 reserves the `0xEF` byte for the future EOF (EVM Object Format), so no runtime code beginning with it may be accepted. The test also verifies that contracts not starting with `0xEF` can still deploy successfully, preventing false-positive rejection.

---

#### 06 — Initcode Size Limit (EIP-3860)

**Contract** `contracts/Eip3860Probe.sol`
**Test** `test/06-eip3860.test.js`

**Purpose**: Verify that a transaction reverts when the CREATE/CREATE2 initcode length exceeds 49,152 bytes (2 × 24,576). EIP-3860 introduced this upper limit in the Berlin ruleset to prevent oversized initcode from consuming excessive resources. The test covers the boundary: 49,152 bytes succeeds, while 49,153 bytes is rejected.

---

#### 07 — Narrowed SELFDESTRUCT Semantics (EIP-6780)

**Contract** `contracts/SelfDestructProbe.sol`
**Test** `test/07-eip6780.test.js`

**Purpose**: Verify the new SELFDESTRUCT semantics after EIP-6780:

- An **existing contract** that calls SELFDESTRUCT transfers only its balance; its code and storage are **not deleted**.
- A contract that is **created and SELFDESTRUCTed in the same transaction** is completely destroyed.

This is a significant Cancun change to SELFDESTRUCT semantics and directly affects contracts that depend on self-destruct patterns.

---

#### 08 — Failed-Transaction Gas Refunds

**Contract** `contracts/RevertProbe.sol`
**Test** `test/08-revert-refund.test.js`

**Purpose**: This is one of the core fixes verified by the node upgrade. Before the upgrade, the node deducted the full `gasLimit × gasPrice` whether a transaction reverted or not. Afterward, it should deduct only the gas actually consumed. The test verifies two failure paths:

- **Explicit revert**: `revert()` aborts execution, charging only `gasUsed` and refunding the remaining gas.
- **Out of gas**: Exhausted gas charges the full `gasLimit`; no gas remains to refund, so this behavior is unchanged.

It also verifies that the `gasUsed` reported by `debug_traceTransaction` matches the receipt's `gasUsed`, confirming the trace path is fixed as well.

---

#### 09 — CLZ Opcode (EIP-7939)

**Contract** `contracts/ClzProbe.sol`
**Test** `test/09-clz.test.js`

**Purpose**: Verify Osaka's new `CLZ` (Count Leading Zeros, `0x1E`) opcode. CLZ returns the number of leading zero bits in a 256-bit integer and is useful for efficient bit operations and math libraries. The test covers boundary values including 0 (256 leading zero bits), 1 (255 leading zero bits), and `2^255` (zero leading zero bits).

---

#### 10 — P256VERIFY Precompile (EIP-7951)

**Contract** `contracts/P256VerifyProbe.sol`
**Test** `test/10-p256verify.test.js`

**Purpose**: Verify the P256VERIFY precompile at address `0x100`, which verifies secp256r1 curve signatures. P256 (also known as NIST P-256) is widely used by WebAuthn, Apple Secure Enclave, smart cards, and other hardware. This precompile lets contracts verify signatures from those devices on-chain and is foundational for account abstraction and passkey wallets. The test verifies that valid signatures return true and tampered signatures return false.

---

#### 11 — ModExp Gas Improvement (EIP-7883)

**Contract** `contracts/ModExpProbe.sol`
**Test** `test/11-modexp7883.test.js`

**Purpose**: Verify that the `0x05` precompile (modular exponentiation: `base^exp mod modulus`) still executes correctly after EIP-7883 adjusts its gas pricing. ModExp is a foundational primitive for RSA, big-number arithmetic, zero-knowledge proofs, and similar applications. The test covers small and large inputs, verifies correct results, and reports actual gas consumption.

---

#### 12 — Contract Code-Size Limit (EIP-7907)

**Contract** `contracts/LargeCodeFactory.sol`
**Test** `test/12-eip7907.test.js`

**Purpose**: Verify that a target network supports EIP-7907 by deploying a 40,000-byte runtime, above EIP-170's 24 KB limit. EIP-7907 raises the maximum runtime code size to 64 KB and the maximum initcode size to 128 KB. The test is enabled by default; a network that has not activated EIP-7907 will fail this compatibility check.

---

### Part 2: ERC Standard Compliance Validation

This section deploys actual OpenZeppelin 5.6 standard contracts to verify that an upgraded EVM executes all core functionality of modern standard contracts correctly.

---

#### 13 — ERC-20 Standard Token

**Contract** `contracts/TestToken.sol`
**Test** `test/13-erc20.test.js`

**Purpose**: Deploy a standard ERC-20 token based on OpenZeppelin 5.6 and verify core interfaces: constructor minting, `balanceOf`, `mint()` (additional issuance), `transfer()` (balances update for both parties), and `totalSupply` changes after minting. This is a foundational test that modern Solidity contracts can deploy and run on the upgraded node.

---

#### 20 — ERC-721 Non-Fungible Token

**Contract** `contracts/NFTToken.sol`
**Test** `test/20-erc721.test.js`

**Purpose**: Deploy an ERC-721 NFT contract based on OpenZeppelin 5.x and verify the complete NFT lifecycle: `mint()` assigns a token ID and token URI, `ownerOf()` queries ownership, `safeTransferFrom()` transfers ownership, `approve()` grants per-token approval and `getApproved` returns the approved address, and `setApprovalForAll()` grants and revokes operator approval in bulk.

---

#### 21 — ERC-20 Permit (EIP-2612)

**Contract** `contracts/PermitToken.sol`
**Test** `test/21-permit.test.js`

**Purpose**: Verify the EIP-2612 gasless-approval flow. A token holder signs an approval message **off-chain** using EIP-712 structured data, and any third party can submit a `permit()` transaction to set the approval without the holder paying gas. The test verifies the full flow—offline signature → `permit()` → correctly updated `allowance`—as well as nonce incrementing for replay protection and rejection of expired deadlines. This mechanism underpins one-click approval-and-action flows in DeFi.

---

#### 26 — ERC-1155 Multi-Token

**Contract** `contracts/TestMultiToken.sol`
**Test** `test/26-erc1155.test.js`

**Purpose**: Deploy an ERC-1155 contract based on OpenZeppelin 5.6 and verify single-ID minting, batch minting, `balanceOfBatch()`, `setApprovalForAll()`, and an operator's `safeBatchTransferFrom()`. This covers state updates and standard authorization paths for multi-token assets.

---

### Part 3: DeFi Primitive Validation

---

#### 22 — Constant-Product AMM (x·y = k)

**Contract** `contracts/SimpleAMM.sol`
**Test** `test/22-amm.test.js`

**Purpose**: Deploy a minimal, fee-free constant-product automated market maker and verify core DeFi pricing behavior: `addLiquidity` establishes initial reserves, `swapAForB`/`swapBForA` exchange in both directions (output = rOut×amtIn/(rIn+amtIn)), reserves update correctly, K is non-decreasing under integer division because rounding favors the pool, and larger trades have worse unit prices because of price impact.

---

#### 27 — Chainlink AggregatorV3 Price Feed

**Contract** `contracts/ChainlinkPriceFeedProbe.sol`
**Test** `test/27-chainlink.test.js`

**Purpose**: Use an ABI-compatible local `MockV3Aggregator` and consumer contract to verify Chainlink `latestRoundData()`, decimal normalization to WAD, new-round updates, and rejection of non-positive prices while retaining the most recent valid price. In production, the consumer can point to an already deployed Chainlink feed.

---

#### 28 — Uniswap v4 PoolKey / slot0

**Contract** `contracts/UniswapV4PoolProbe.sol`
**Test** `test/28-uniswap-v4.test.js`

**Purpose**: Deploy the official `PoolManager` artifact from the `@uniswap/v4-core` release package. Using the official `IPoolManager`, `PoolKey`, `PoolIdLibrary`, and `StateLibrary`, verify currency sorting, `initialize` call encoding, and `slot0` decoding (sqrt price, tick, protocol fee, and LP fee). The test also compares on-chain runtime byte-for-byte against the official artifact template, excluding the immutable owner set by the constructor, and verifies that reinitializing the same PoolKey is rejected. The probe itself is compiled for Osaka; the official PoolManager artifact remains the upstream-specified build output.

---

### Part 4: Smart-Contract Pattern Validation

This section verifies that common Solidity design patterns run correctly on the upgraded node.

---

#### 14 — Reentrancy-Attack Defense

**Contract** `contracts/ReentrancyContracts.sol` (`VulnerableTarget`, `ProtectedTarget`, `Attacker`)
**Test** `test/14-reentrancy.test.js`

**Purpose**: Verify the on-chain behavior of reentrancy attacks and defenses:

- `VulnerableTarget` (unprotected): The attacker's fallback can recursively re-enter, allowing repeated calls.
- `ProtectedTarget` (`ReentrancyGuard`): The `nonReentrant` modifier blocks and reverts the second recursive call.

The test also verifies correct EVM call-stack behavior and revert propagation after the upgrade.

---

#### 15 — Deep Revert Propagation

**Contract** `contracts/revert.sol` (`DeepRevertProbe`)
**Test** `test/15-deep-revert.test.js`

**Purpose**: Verify how reverts propagate through multi-level nested EVM calls. `execute(maxDepth, revertAtDepth)` precisely selects which depth triggers a revert, which the outer layer catches with `try/catch`. Covered scenarios include depth 0 (the outer layer reverts directly), a revert at any intermediate depth (state is retained after the outer catch), a full recursion with no revert, and gas usage that rises monotonically with recursion depth (confirming the expected call-stack overhead of roughly +144 gas per layer).

---

#### 16 — Deterministic CREATE2 Deployment

**Contract** `contracts/Create2Contracts.sol` (`Create2Factory`, `Counter`)
**Test** `test/16-create2.test.js`

**Purpose**: Verify that CREATE2 permits a contract address to be predicted exactly **before deployment** (`address = keccak256(0xff ‖ deployer ‖ salt ‖ keccak256(bytecode))`) and that only different salts produce different deployment addresses. The test covers matching predicted and actual addresses, functioning contracts after deployment, a repeated deployment with the same salt returning the zero address as collision detection, and different salts producing different addresses. CREATE2 is foundational for minimal proxies (clones), account abstraction, and on-chain factory contracts.

---

#### 17 — DELEGATECALL Proxy Upgrade Pattern

**Contract** `contracts/ProxyContracts.sol` (`LogicV1`, `LogicV2`, `SimpleProxy`)
**Test** `test/17-delegatecall.test.js`

**Purpose**: Verify an EIP-1967 upgradeable-proxy pattern. `SimpleProxy` forwards all calls through `DELEGATECALL` to the current implementation, allowing business logic to upgrade seamlessly:

- `setValue(n)` in V1 writes n directly to slot 0 of the proxy.
- After upgrading to V2, the data in the same slot remains intact; storage is not cleared.
- `setValue(n)` in V2 writes n×2, proving the logic changed after upgrade.
- The logic contracts' own storage remains zero because writes occur in the proxy's storage context.

---

#### 18 — ECDSA Signature Verification (EIP-191 / EIP-712)

**Contract** `contracts/ECDSAProbe.sol`
**Test** `test/18-ecdsa.test.js`

**Purpose**: Verify two standards for on-chain ECDSA signature verification:

- **EIP-191 (`personal_sign`)**: Ethereum personal signatures with the `\x19Ethereum Signed Message:\n32` prefix. A valid signature recovers the correct address; an invalid signature recovers a different address.
- **EIP-712 (structured data)**: Typed signatures with a domain separator that prevents cross-chain and cross-contract replay. The test verifies that valid signatures pass and different signers are rejected.

On-chain ECDSA verification is a core dependency for multisig wallets, off-chain authorization, and permit-style contracts.

---

#### 19 — Custom Errors (EIP-838)

**Contract** `contracts/CustomErrorProbe.sol`
**Test** `test/19-custom-errors.test.js`

**Purpose**: Verify two on-chain properties of Solidity custom errors such as `error InsufficientBalance(uint256 available, uint256 required)`:

- **Correct reverts**: Both custom errors and `require` strings roll back the transaction (`status=0`).
- **Gas efficiency**: Custom errors save approximately 67 gas compared with `require` strings because no long string needs encoding.

Custom errors are the recommended modern contract error-handling approach and are widely used by upgraded Solidity 0.8.x contracts.

---

#### 23 — Access Control / Ownable

**Contract** `contracts/AccessControlProbe.sol`
**Test** `test/23-access-control.test.js`

**Purpose**: Verify a two-layer access-control model: an owner (unique and managed through OZ Ownable) plus an operator allowlist that the owner can update dynamically. Core checks include owner write access, false mapping state for non-operator addresses, allowlist changes through `addOperator`/`removeOperator`, and ownership transfer through `transferOwnership`. Permission models are a security foundation for production contracts.

---

#### 24 — Timelock (`block.timestamp`)

**Contract** `contracts/TimelockProbe.sol`
**Test** `test/24-timelock.test.js`

**Purpose**: Verify the reliability of `block.timestamp` and an execution-delay mechanism based on a timelock: execution is immediate when delay=0, `execute()` is blocked with LOCKED when delay>0, a second call after execution is blocked with ALREADY_EXECUTED as one-time protection, and `timeRemaining()` returns a value in the range (0, delay]. Timelocks are a standard pattern for DAO governance and protocol-upgrade delays.

---

#### 25 — Multicall Batch Operations

**Contract** `contracts/MulticallProbe.sol`
**Test** `test/25-multicall.test.js`

**Purpose**: Verify a DELEGATECALL-based Multicall pattern that executes several self-calls sequentially **within one transaction**, with every write taking effect in the same storage context. It verifies that a single call matches a direct call, five batched `increment` calls produce the correct count, mixed calls (`increment` + `setMessage`) both take effect, `addN` accurately sums a batch, and **atomicity** holds—if any call in a batch reverts, every state write in that batch is rolled back. Multicall is a general optimization pattern for reducing the number of on-chain interactions.

---

## Directory Structure

```
evm-upgrade-tests/
├── contracts/               # Contracts under test (minimal probe contracts)
│   ├── Push0Probe.sol
│   ├── TransientProbe.sol
│   ├── McopyProbe.sol
│   ├── BlockEnvProbe.sol
│   ├── Eip3541Probe.sol
│   ├── Eip3860Probe.sol
│   ├── SelfDestructProbe.sol
│   ├── RevertProbe.sol
│   ├── ClzProbe.sol
│   ├── P256VerifyProbe.sol
│   ├── ModExpProbe.sol
│   ├── LargeCodeFactory.sol # EIP-7907 compatibility fixture
│   ├── TestToken.sol        # ERC-20
│   ├── NFTToken.sol         # ERC-721
│   ├── TestMultiToken.sol   # ERC-1155 (OZ 5.6)
│   ├── PermitToken.sol      # ERC-20 + EIP-2612 Permit
│   ├── SimpleAMM.sol        # x*y=k AMM
│   ├── ChainlinkPriceFeedProbe.sol
│   ├── UniswapV4PoolProbe.sol
│   ├── ReentrancyContracts.sol
│   ├── revert.sol           # DeepRevertProbe
│   ├── Create2Contracts.sol
│   ├── ProxyContracts.sol   # EIP-1967 proxy
│   ├── ECDSAProbe.sol
│   ├── CustomErrorProbe.sol
│   ├── AccessControlProbe.sol
│   ├── TimelockProbe.sol
│   └── MulticallProbe.sol
├── test/
│   ├── _helpers.js          # Shared utilities such as sendRaw / writeCall
│   ├── 01-push0.test.js
│   ├── 02-transient.test.js
│   ├── 03-mcopy.test.js
│   ├── 04-blockenv.test.js
│   ├── 05-eip3541.test.js
│   ├── 06-eip3860.test.js
│   ├── 07-eip6780.test.js
│   ├── 08-revert-refund.test.js
│   ├── 09-clz.test.js
│   ├── 10-p256verify.test.js
│   ├── 11-modexp7883.test.js
│   ├── 12-eip7907.test.js   # EIP-7907 compatibility
│   ├── 13-erc20.test.js
│   ├── 14-reentrancy.test.js
│   ├── 15-deep-revert.test.js
│   ├── 16-create2.test.js
│   ├── 17-delegatecall.test.js
│   ├── 18-ecdsa.test.js
│   ├── 19-custom-errors.test.js
│   ├── 20-erc721.test.js
│   ├── 21-permit.test.js
│   ├── 22-amm.test.js
│   ├── 23-access-control.test.js
│   ├── 24-timelock.test.js
│   ├── 25-multicall.test.js
│   ├── 26-erc1155.test.js
│   ├── 27-chainlink.test.js
│   └── 28-uniswap-v4.test.js
├── hardhat.config.js
└── package.json
```

---

## Usage

```bash
cd evm-upgrade-tests
npm install
npm run compile

# Local Osaka node: start in terminal A
npm run node
# Run the full test suite in terminal B
npm run test:node

# Run against a target node (.env required)
npx hardhat test --network local
# Or run an individual test file
npx hardhat test --network local ./test/08-revert-refund.test.js
```

**`.env` configuration**:

```env
DEPLOY_PRIVATE_KEY=0x...   # Private key of a funded account
RPC_URL=http://<host>:<port>
SYSTEM_ADMIN_ADDRESS=0x... # Administrator of the fixed-address system contracts
```

The local node runs with `hardfork: "osaka"`, Solidity `0.8.36`, and `evmVersion: "osaka"`.

The system-contract tests attach to the blacklist at
`0x000000000000000000000000000000000000B1AC` and SysConfig at
`0x000000000000000000000000000000000000C0F1`. Blacklist tests compare the
active signer with `SYSTEM_ADMIN_ADDRESS`. SysConfig tests verify that the
configured account holds both AccessControl `DEFAULT_ADMIN_ROLE` and
`ADMIN_ROLE`; an `ADMIN_ROLE` holder exercises successful writes, while a
non-holder verifies that the same protected writes revert. Development
networks without code at these fixed addresses skip the system-contract cases.
`test/32-system-config-uups.test.js` deploys an isolated `SystemConfig` proxy,
upgrades it from V1 to V2 with `UPGRADE_ROLE`, and verifies the implementation
slot and namespaced configuration storage. It never upgrades the fixed-address
system proxy.

---

## Behavior Before and After the Upgrade

| Test | Expected behavior before the upgrade | Expected behavior after the upgrade |
|------|--------------------------------------|-------------------------------------|
| 01 PUSH0 | Deployment of a contract containing `0x5F` fails with an invalid opcode. | Deployment and execution succeed. |
| 02 TLOAD/TSTORE | Invalid opcode. | Correct round trip, cleared between transactions, revert rollback. |
| 03 MCOPY | Invalid opcode. | Bytes are copied intact. |
| 04 BASEFEE | `block.basefee = 0`. | Returns the chain's actual protocol fee. |
| 04 PREVRANDAO | A fixed value or 0. | A non-deterministic value that differs for each block. |
| 05 EIP-3541 | Contracts beginning with `0xEF` can deploy. | Rejected; the transaction reverts. |
| 06 EIP-3860 | 49,153-byte initcode reaches the EVM. | Reverts because it exceeds the limit. |
| 07 EIP-6780 | An older contract's code disappears after SELFDESTRUCT. | Code remains; only the balance transfers. |
| 08 Gas refund | A revert charges the full gas limit. | Only `gasUsed` is charged; the difference is refunded. |
| 09–11 Osaka | CLZ/P256VERIFY/ModExp unavailable or incorrect. | Execute correctly. |
| 12 EIP-7907 | Runtime code above 24 KB is rejected. | A 40,000-byte runtime deploys successfully. |
| 13–28 Standards and ecosystem contracts | Solidity 0.8.x / standard interfaces fail to deploy or behave incorrectly. | OZ 5.6, Chainlink, and Uniswap v4 compatibility paths all work correctly. |

| Validation scope | Contents | Result |
|------------------|----------|--------|
| Osaka/EVM instructions and rules | PUSH0, TSTORE/TLOAD, MCOPY, CLZ, P256VERIFY, ModExp, EIP-3541, EIP-3860, EIP-6780 | Passed |
| Block and transaction behavior | Block environment variables, failed-transaction gas refunds, OOG gas, consistency between `debug_traceTransaction` and receipts | Passed |
| General contract capabilities | Deep reverts, CREATE2, Proxy/DELEGATECALL upgrades, ECDSA/EIP-712, custom errors, reentrancy protection, Timelock, Multicall | Passed |
| OZ 5.6 standard contracts | ERC-20, ERC-721, ERC-1155, ERC-20 Permit/EIP-2612 | Passed |
| DeFi/oracles | Constant-product AMM, Chainlink AggregatorV3 mock and consumer price normalization/fallback for invalid prices | Passed |
