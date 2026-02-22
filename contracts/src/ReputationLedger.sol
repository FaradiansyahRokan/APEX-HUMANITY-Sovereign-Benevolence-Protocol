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

    mapping(address => ReputationRecord) private _records;

    struct ScoreEntry {
        uint256 score;
        uint256 timestamp;
        bytes32 eventHash;
    }
    mapping(address => ScoreEntry[]) private _scoreHistory;

    address[] public leaderboard;
    mapping(address => bool) private _inLeaderboard;

    uint256 public totalParticipants;
    uint256 public totalImpactScoreGenerated;

    // ── Achievement Badge System ──────────────────────────────────────────────

    // Badge IDs — each is a unique uint8
    uint8 public constant BADGE_FIRST_STEP    = 1;   // First submission
    uint8 public constant BADGE_HELPER        = 2;   // 5 events
    uint8 public constant BADGE_DEDICATED     = 3;   // 10 events
    uint8 public constant BADGE_CHAMPION      = 4;   // 25 events
    uint8 public constant BADGE_LEGEND        = 5;   // 50 events
    uint8 public constant BADGE_HIGH_IMPACT   = 6;   // Single event score ≥ 80
    uint8 public constant BADGE_PERFECT       = 7;   // Single event score = 100
    uint8 public constant BADGE_CENTURY       = 8;   // Cumulative score ≥ 10,000
    uint8 public constant BADGE_TITAN         = 9;   // Cumulative score ≥ 50,000

    // volunteer => badgeId => earned
    mapping(address => mapping(uint8 => bool)) private _badges;

    // All badge IDs earned by a volunteer (for easy enumeration)
    mapping(address => uint8[]) private _badgeList;

    struct BadgeInfo {
        uint8   id;
        string  name;
        string  description;
        string  icon;
        uint256 earnedAt;   // 0 = not earned
    }

    // volunteer => badgeId => timestamp earned
    mapping(address => mapping(uint8 => uint256)) private _badgeEarnedAt;

    // ── Events ────────────────────────────────────────────────────────────────
    event ReputationUpdated(
        address indexed volunteer,
        uint256 scoreDelta,
        uint256 newCumulativeScore,
        uint256 eventCount,
        uint256 timestamp
    );

    event LeaderboardEntryAdded(address indexed volunteer, uint256 timestamp);

    event BadgeEarned(
        address indexed volunteer,
        uint8   indexed badgeId,
        string  badgeName,
        uint256 timestamp
    );

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ── Core Update (only callable by BenevolenceVault) ───────────────────────

    function updateReputation(address volunteer, uint256 scoreDelta)
        external
        onlyRole(VAULT_ROLE)
        returns (uint256 newCumulative)
    {
        ReputationRecord storage record = _records[volunteer];

        record.cumulativeScore  += scoreDelta;
        record.eventCount       += 1;
        record.lastUpdatedAt     = block.timestamp;

        _scoreHistory[volunteer].push(ScoreEntry({
            score:     scoreDelta,
            timestamp: block.timestamp,
            eventHash: bytes32(0)
        }));

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

        // ── Auto-award badges ─────────────────────────────────────────────────
        _checkAndAwardBadges(volunteer, scoreDelta, record.eventCount, record.cumulativeScore);
    }

    // ── Badge Internal Logic ──────────────────────────────────────────────────

    function _awardBadge(address volunteer, uint8 badgeId, string memory name) internal {
        if (_badges[volunteer][badgeId]) return; // already earned
        _badges[volunteer][badgeId]        = true;
        _badgeEarnedAt[volunteer][badgeId] = block.timestamp;
        _badgeList[volunteer].push(badgeId);
        emit BadgeEarned(volunteer, badgeId, name, block.timestamp);
    }

    function _checkAndAwardBadges(
        address volunteer,
        uint256 scoreDelta,        // scaled ×100
        uint256 eventCount,
        uint256 cumulativeScore    // scaled ×100
    ) internal {
        // Event-count milestones
        if (eventCount >= 1)  _awardBadge(volunteer, BADGE_FIRST_STEP, "First Step");
        if (eventCount >= 5)  _awardBadge(volunteer, BADGE_HELPER,     "Helper");
        if (eventCount >= 10) _awardBadge(volunteer, BADGE_DEDICATED,  "Dedicated");
        if (eventCount >= 25) _awardBadge(volunteer, BADGE_CHAMPION,   "Champion");
        if (eventCount >= 50) _awardBadge(volunteer, BADGE_LEGEND,     "Legend");

        // Single-event score milestones (scoreDelta is impact_score × 100)
        if (scoreDelta >= 8000)  _awardBadge(volunteer, BADGE_HIGH_IMPACT, "High Impact");
        if (scoreDelta >= 10000) _awardBadge(volunteer, BADGE_PERFECT,     "Perfect Score");

        // Cumulative score milestones
        if (cumulativeScore >= 1_000_000)  _awardBadge(volunteer, BADGE_CENTURY, "Century");
        if (cumulativeScore >= 5_000_000)  _awardBadge(volunteer, BADGE_TITAN,   "Titan");
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

    function hasBadge(address volunteer, uint8 badgeId) external view returns (bool) {
        return _badges[volunteer][badgeId];
    }

    function getBadges(address volunteer) external view returns (uint8[] memory) {
        return _badgeList[volunteer];
    }

    function getBadgeEarnedAt(address volunteer, uint8 badgeId)
        external view returns (uint256)
    {
        return _badgeEarnedAt[volunteer][badgeId];
    }

    /// @notice Returns full badge info for all 9 badges for a given volunteer.
    function getAllBadges(address volunteer)
        external view
        returns (BadgeInfo[] memory badges)
    {
        badges = new BadgeInfo[](9);

        string[9] memory names = [
            "First Step", "Helper", "Dedicated", "Champion", "Legend",
            "High Impact", "Perfect Score", "Century", "Titan"
        ];
        string[9] memory descs = [
            "Submitted your first impact proof",
            "Completed 5 verified impact events",
            "Completed 10 verified impact events",
            "Completed 25 verified impact events",
            "Completed 50 verified impact events",
            "Achieved impact score 80+ in a single event",
            "Achieved a perfect 100 impact score",
            "Accumulated 10,000+ cumulative impact points",
            "Accumulated 50,000+ cumulative impact points"
        ];
        string[9] memory icons = [
            unicode"🌱", unicode"🤝", unicode"⭐", unicode"⚔️", unicode"🏆",
            unicode"🔥", unicode"💯", unicode"🌍", unicode"⚡"
        ];
        uint8[9] memory ids = [
            BADGE_FIRST_STEP, BADGE_HELPER, BADGE_DEDICATED,
            BADGE_CHAMPION, BADGE_LEGEND,
            BADGE_HIGH_IMPACT, BADGE_PERFECT,
            BADGE_CENTURY, BADGE_TITAN
        ];

        for (uint256 i = 0; i < 9; i++) {
            badges[i] = BadgeInfo({
                id:       ids[i],
                name:     names[i],
                description: descs[i],
                icon:     icons[i],
                earnedAt: _badgeEarnedAt[volunteer][ids[i]]
            });
        }
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
