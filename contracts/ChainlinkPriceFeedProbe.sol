// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice ABI-compatible with Chainlink's AggregatorV3Interface.
/// @dev A local mock is required because a production feed is an external service,
/// so the suite can run against a new testnet immediately after an EVM upgrade.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);
    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80, int256, uint256, uint256, uint80);
    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80);
}

/// @notice Minimal Chainlink AggregatorV3 test fixture; not for production use.
contract MockV3Aggregator is AggregatorV3Interface {
    error NoDataPresent();

    struct Round {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    uint8 public immutable override decimals;
    string public override description;
    uint256 public constant override version = 1;
    uint80 public latestRoundId;
    mapping(uint80 roundId => Round) private _rounds;

    constructor(uint8 feedDecimals, int256 initialAnswer) {
        decimals = feedDecimals;
        description = "MOVA / USD test feed";
        _updateAnswer(initialAnswer);
    }

    function updateAnswer(int256 answer) external {
        _updateAnswer(answer);
    }

    function getRoundData(uint80 roundId)
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        Round memory round = _rounds[roundId];
        if (round.updatedAt == 0) revert NoDataPresent();
        return (roundId, round.answer, round.startedAt, round.updatedAt, round.answeredInRound);
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        Round memory round = _rounds[latestRoundId];
        return (latestRoundId, round.answer, round.startedAt, round.updatedAt, round.answeredInRound);
    }

    function _updateAnswer(int256 answer) private {
        uint80 roundId = ++latestRoundId;
        _rounds[roundId] = Round({
            answer: answer,
            startedAt: block.timestamp,
            updatedAt: block.timestamp,
            answeredInRound: roundId
        });
    }
}

/// @notice Reads the canonical Chainlink V3 interface and persists a WAD price.
contract ChainlinkPriceConsumer {
    error InvalidAnswer(int256 answer);
    error IncompleteRound(uint80 roundId, uint80 answeredInRound, uint256 updatedAt);

    AggregatorV3Interface public immutable feed;
    uint8 public immutable feedDecimals;
    uint80 public lastRoundId;
    uint256 public lastPriceWad;
    uint256 public lastUpdatedAt;

    constructor(AggregatorV3Interface feed_) {
        feed = feed_;
        feedDecimals = feed_.decimals();
    }

    function readAndStore() external returns (uint256 priceWad) {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        if (answer <= 0) revert InvalidAnswer(answer);
        if (updatedAt == 0 || answeredInRound < roundId) {
            revert IncompleteRound(roundId, answeredInRound, updatedAt);
        }

        priceWad = _toWad(uint256(answer));
        lastRoundId = roundId;
        lastPriceWad = priceWad;
        lastUpdatedAt = updatedAt;
    }

    function _toWad(uint256 answer) private view returns (uint256) {
        if (feedDecimals <= 18) return answer * (10 ** (18 - feedDecimals));
        return answer / (10 ** (feedDecimals - 18));
    }
}
