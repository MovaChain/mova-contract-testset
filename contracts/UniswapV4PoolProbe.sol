// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

/// @notice Uses Uniswap v4-core's canonical ABI and storage-reader library.
/// @dev The test deploys the official v4-core PoolManager artifact. Its source
/// is pinned to solc 0.8.26 upstream; this probe compiles with the Osaka target
/// and calls the production bytecode through the official interface.
contract UniswapV4PoolProbe {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    error IdenticalCurrencies();

    PoolId public lastPoolId;
    int24 public lastTick;
    uint160 public lastSqrtPriceX96;
    uint24 public lastProtocolFee;
    uint24 public lastLpFee;

    function initializeAndRead(
        IPoolManager manager,
        address tokenA,
        address tokenB,
        uint160 sqrtPriceX96
    ) external returns (PoolId poolId, int24 tick) {
        if (tokenA == tokenB) revert IdenticalCurrencies();

        (Currency currency0, Currency currency1) = tokenA < tokenB
            ? (Currency.wrap(tokenA), Currency.wrap(tokenB))
            : (Currency.wrap(tokenB), Currency.wrap(tokenA));
        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        poolId = key.toId();
        tick = manager.initialize(key, sqrtPriceX96);
        (lastSqrtPriceX96, lastTick, lastProtocolFee, lastLpFee) = manager.getSlot0(poolId);
        lastPoolId = poolId;
    }
}
