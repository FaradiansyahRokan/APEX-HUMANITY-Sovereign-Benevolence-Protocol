// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ReputationLedger — APEX HUMANITY Protocol
 * @notice Immutable, append-only registry of verified impact events.
 *         Once an impact is recorded, it CANNOT be deleted or modified.
 *         This is the "Soulbound Reputation" of APEX HUMANITY.
 *
 * @dev Only the BenevolenceVault (trusted caller) can write to this contract.
 *      All historical records are forever preserved on-chain.
 */

import "@openzeppelin/contracts/access/Ownable.sol";

error RL__OnlyVaultCanRecord();
error RL__VaultAlreadySet();
error RL__ZeroAddress();

event ImpactRecorded(
    address indexed volunteer,
    bytes32 indexed eventHash,
    uint256 impactScore,
    string actionType,
    uint256 cumulativeScore,
    uint256 timestamp
);

event ImpactRankReached(address indexed volunteer, string rank, uint256 timestamp);

contract ReputationLedger is Ownable {

    // ── Reputation Rank Thresholds (cumulative score × 100) ───────────────────
    uint256 public constant RANK_GUARDIAN_THRESHOLD   = 100_00;   // 100 points
    uint256 public constant RANK_CHAMPION_THRESHOLD   = 500_00;   // 500 points
    uint256 public constant RANK_SOVEREIGN_THRESHOLD  = 2000_00;  // 2000 points
    uint256 public constant RANK_APEX_THRESHOLD       = 10000_00; // 10000 points

    // ── Structs ───────────────────────────────────────────────────────────────
    struct ImpactRecord {
        bytes32 eventHash;
        uint256 impactScore;      // × 100 precision
        string actionType;
        uint256 timestamp;
    }

    struct VolunteerProfile {
        uint256 cumulativeScore;   // Total accumulated score × 100
        uint256 eventCount;        // Number of verified impact events
        string currentRank;        // "CITIZEN" | "GUARDIAN" | "CHAMPION" | "SOVEREIGN" | "APEX"
        uint256 firstImpactAt;     // Timestamp of first impact
        uint256 lastImpactAt;      // Timestamp of most recent impact
    }

    // ── State ─────────────────────────────────────────────────────────────────
    address public benevolenceVault;

    mapping(address => VolunteerProfile) private _profiles;
    mapping(address => ImpactRecord[]) private _impactHistory;
    mapping(bytes32 => address) private _eventToVolunteer;

    // Global leaderboard — top volunteers tracked
    address[] private _volunteersIndex;
    mapping(address => bool) private _isRegistered;

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyVault() {
        if (msg.sender != benevolenceVault) revert RL__OnlyVaultCanRecord();
        _;
    }

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    // ── Admin ──────────────────────────────────────────────────────────────────
    function setBenevolenceVault(address vault) external onlyOwner {
        if (benevolenceVault != address(0)) revert RL__VaultAlreadySet();
        if (vault == address(0)) revert RL__ZeroAddress();
        benevolenceVault = vault;
    }

    // ── Core Write (only BenevolenceVault) ────────────────────────────────────

    /**
     * @notice Records a verified impact event. Called exclusively by BenevolenceVault.
     * @dev Append-only. Score is cumulative and immutable once written.
     */
    function recordImpact(
        address volunteer,
        bytes32 eventHash,
        uint256 impactScore,
        string calldata actionType
    ) external onlyVault {
        VolunteerProfile storage profile = _profiles[volunteer];

        // Register volunteer if first impact
        if (!_isRegistered[volunteer]) {
            _isRegistered[volunteer] = true;
            _volunteersIndex.push(volunteer);
            profile.currentRank = "CITIZEN";
            profile.firstImpactAt = block.timestamp;
        }

        // Append immutable record
        _impactHistory[volunteer].push(ImpactRecord({
            eventHash: eventHash,
            impactScore: impactScore,
            actionType: actionType,
            timestamp: block.timestamp
        }));
        _eventToVolunteer[eventHash] = volunteer;

        // Update cumulative stats
        profile.cumulativeScore += impactScore;
        profile.eventCount++;
        profile.lastImpactAt = block.timestamp;

        // Update rank
        string memory newRank = _calculateRank(profile.cumulativeScore);
        if (keccak256(bytes(newRank)) != keccak256(bytes(profile.currentRank))) {
            profile.currentRank = newRank;
            emit ImpactRankReached(volunteer, newRank, block.timestamp);
        }

        emit ImpactRecorded(
            volunteer,
            eventHash,
            impactScore,
            actionType,
            profile.cumulativeScore,
            block.timestamp
        );
    }

    // ── View Functions ─────────────────────────────────────────────────────────

    function getReputation(address volunteer) external view returns (uint256) {
        return _profiles[volunteer].cumulativeScore;
    }

    function getProfile(address volunteer)
        external
        view
        returns (VolunteerProfile memory)
    {
        return _profiles[volunteer];
    }

    function getImpactHistory(address volunteer)
        external
        view
        returns (ImpactRecord[] memory)
    {
        return _impactHistory[volunteer];
    }

    function getVolunteerCount() external view returns (uint256) {
        return _volunteersIndex.length;
    }

    /**
     * @notice Returns the global leaderboard (top N volunteers by score).
     * @dev O(n²) — use The Graph subgraph for production pagination.
     */
    function getLeaderboard(uint256 topN)
        external
        view
        returns (address[] memory leaders, uint256[] memory scores, string[] memory ranks)
    {
        uint256 total = _volunteersIndex.length;
        uint256 count = topN < total ? topN : total;
        leaders = new address[](count);
        scores = new uint256[](count);
        ranks = new string[](count);

        // Simple sort for demo — use off-chain indexer in production
        address[] memory candidates = new address[](total);
        for (uint256 i = 0; i < total; i++) {
            candidates[i] = _volunteersIndex[i];
        }

        // Bubble sort (gas-intensive — ok for view functions)
        for (uint256 i = 0; i < total - 1; i++) {
            for (uint256 j = 0; j < total - i - 1; j++) {
                if (
                    _profiles[candidates[j]].cumulativeScore <
                    _profiles[candidates[j + 1]].cumulativeScore
                ) {
                    (candidates[j], candidates[j + 1]) = (candidates[j + 1], candidates[j]);
                }
            }
        }

        for (uint256 i = 0; i < count; i++) {
            leaders[i] = candidates[i];
            scores[i] = _profiles[candidates[i]].cumulativeScore;
            ranks[i] = _profiles[candidates[i]].currentRank;
        }
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    function _calculateRank(uint256 score) internal pure returns (string memory) {
        if (score >= RANK_APEX_THRESHOLD)      return "APEX";
        if (score >= RANK_SOVEREIGN_THRESHOLD) return "SOVEREIGN";
        if (score >= RANK_CHAMPION_THRESHOLD)  return "CHAMPION";
        if (score >= RANK_GUARDIAN_THRESHOLD)  return "GUARDIAN";
        return "CITIZEN";
    }
}
