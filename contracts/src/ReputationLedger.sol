// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║          APEX HUMANITY — ReputationLedger.sol                           ║
 * ║                                                                          ║
 * ║  Immutable, append-only reputation score registry.                      ║
 * ║  Scores are Soulbound: they cannot be transferred, sold, or deleted.    ║
 * ║  A transparent record of every good deed — forever.                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import "@openzeppelin/contracts/access/AccessControl.sol";

contract ReputationLedger is AccessControl {

    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    // ── Score Storage ─────────────────────────────────────────────────────────
    struct ReputationRecord {
        uint256 cumulativeScore;     // Total lifetime impact score
        uint256 eventCount;          // Number of verified impact events
        uint256 lastUpdatedAt;       // Unix timestamp of last update
        uint256 rank;                // Global rank (updated periodically by DAO)
    }

    // volunteer address => ReputationRecord
    mapping(address => ReputationRecord) private _records;

    // Append-only history: volunteer => list of score deltas
    struct ScoreEntry {
        uint256 score;
        uint256 timestamp;
        bytes32 eventHash; // Links back to the specific BenevolenceVault event
    }
    mapping(address => ScoreEntry[]) private _scoreHistory;

    // Sorted leaderboard keys (maintained off-chain, anchored on-chain)
    address[] public leaderboard;
    mapping(address => bool) private _inLeaderboard;

    uint256 public totalParticipants;
    uint256 public totalImpactScoreGenerated;

    // ── Events ────────────────────────────────────────────────────────────────
    event ReputationUpdated(
        address indexed volunteer,
        uint256 scoreDelta,
        uint256 newCumulativeScore,
        uint256 eventCount,
        uint256 timestamp
    );

    event LeaderboardEntryAdded(address indexed volunteer, uint256 timestamp);

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ── Core Update (only callable by BenevolenceVault) ───────────────────────

    /**
     * @notice Updates a volunteer's reputation score. Called by BenevolenceVault
     *         after a verified impact event.
     * @param volunteer  Address to update
     * @param scoreDelta ImpactScore × 100 from this specific event
     * @return newCumulative The volunteer's new total cumulative score
     */
    function updateReputation(address volunteer, uint256 scoreDelta)
        external
        onlyRole(VAULT_ROLE)
        returns (uint256 newCumulative)
    {
        ReputationRecord storage record = _records[volunteer];

        record.cumulativeScore  += scoreDelta;
        record.eventCount       += 1;
        record.lastUpdatedAt     = block.timestamp;

        // Append to immutable score history
        _scoreHistory[volunteer].push(ScoreEntry({
            score:     scoreDelta,
            timestamp: block.timestamp,
            eventHash: bytes32(0) // In production: pass actual eventHash
        }));

        // Register new participants
        if (!_inLeaderboard[volunteer]) {
            _inLeaderboard[volunteer] = true;
            leaderboard.push(volunteer);
            totalParticipants += 1;
            emit LeaderboardEntryAdded(volunteer, block.timestamp);
        }

        totalImpactScoreGenerated += scoreDelta;
        newCumulative = record.cumulativeScore;

        emit ReputationUpdated(
            volunteer,
            scoreDelta,
            record.cumulativeScore,
            record.eventCount,
            block.timestamp
        );
    }

    // ── View Functions ────────────────────────────────────────────────────────

    function getReputation(address volunteer)
        external view
        returns (
            uint256 cumulativeScore,
            uint256 eventCount,
            uint256 lastUpdatedAt,
            uint256 rank
        )
    {
        ReputationRecord storage r = _records[volunteer];
        return (r.cumulativeScore, r.eventCount, r.lastUpdatedAt, r.rank);
    }

    function getScoreHistory(address volunteer)
        external view
        returns (ScoreEntry[] memory)
    {
        return _scoreHistory[volunteer];
    }

    function getLeaderboardLength() external view returns (uint256) {
        return leaderboard.length;
    }

    function getLeaderboardPage(uint256 offset, uint256 limit)
        external view
        returns (address[] memory addresses, uint256[] memory scores)
    {
        uint256 end = offset + limit;
        if (end > leaderboard.length) end = leaderboard.length;
        uint256 len = end - offset;
        addresses = new address[](len);
        scores    = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            addresses[i] = leaderboard[offset + i];
            scores[i]    = _records[leaderboard[offset + i]].cumulativeScore;
        }
    }

    function getGlobalStats() external view
        returns (uint256 participants, uint256 totalScore)
    {
        return (totalParticipants, totalImpactScoreGenerated);
    }
}
