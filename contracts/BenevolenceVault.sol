// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BenevolenceVault — APEX HUMANITY Protocol
 * @author APEX HUMANITY Core
 * @notice Escrow vault that releases funds only upon verified oracle signatures
 *         from the SATIN (Sovereign Autonomous Trust & Impact Network) AI Oracle.
 *
 * ARCHITECTURE:
 *   Donor → deposits USDC into vault
 *   Volunteer submits Impact Proof → SATIN Oracle verifies → Oracle signs message
 *   Volunteer submits signed oracle payload on-chain
 *   Contract verifies ECDSA signature → releases funds + mints GOOD tokens
 *   ReputationLedger updated (immutable, soulbound)
 *
 * @dev Uses ECDSA from OpenZeppelin for signature verification.
 *      All oracle messages must be signed by the registered oracle address.
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

// ── Interfaces ────────────────────────────────────────────────────────────────

interface IGoodToken {
    function mint(address to, uint256 amount) external;
}

interface IReputationLedger {
    function recordImpact(
        address volunteer,
        bytes32 eventHash,
        uint256 impactScore,
        string calldata actionType
    ) external;

    function getReputation(address volunteer) external view returns (uint256);
}

// ── Custom Errors ──────────────────────────────────────────────────────────────

error BV__InvalidOracleSignature();
error BV__EventAlreadyProcessed(bytes32 eventHash);
error BV__InsufficientVaultBalance(uint256 available, uint256 required);
error BV__InvalidImpactScore(uint256 score);
error BV__ZeroAddress();
error BV__UnauthorizedOracle(address signer, address expected);
error BV__DonationTooSmall(uint256 sent, uint256 minimum);
error BV__TokenTransferFailed();

// ── Events ─────────────────────────────────────────────────────────────────────

event FundsDonated(address indexed donor, uint256 amount, uint256 timestamp);
event ImpactVerified(
    bytes32 indexed eventHash,
    address indexed volunteer,
    bytes32 indexed beneficiaryZKPHash,
    uint256 impactScore,
    uint256 rewardAmount,
    string actionType
);
event ReputationUpdated(address indexed volunteer, uint256 newScore, uint256 totalScore);
event OracleUpdated(address indexed oldOracle, address indexed newOracle);
event EmergencyWithdrawal(address indexed to, uint256 amount);

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @title BenevolenceVault
 */
contract BenevolenceVault is Ownable, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────────
    uint256 public constant SCORE_PRECISION = 100;   // ImpactScore stored × 100
    uint256 public constant MAX_IMPACT_SCORE = 10000; // 100.00 × 100
    uint256 public constant MIN_DONATION = 1e6;       // 1 USDC (6 decimals)
    uint256 public constant GOOD_TOKEN_MULTIPLIER = 10 ether; // 10 GOOD per score point

    // ── State Variables ────────────────────────────────────────────────────────

    /// @notice USDC or stablecoin held in escrow
    IERC20 public immutable stablecoin;

    /// @notice GOOD Impact Token contract
    IGoodToken public immutable goodToken;

    /// @notice Immutable Reputation Ledger
    IReputationLedger public immutable reputationLedger;

    /// @notice The authorized SATIN Oracle address (ECDSA signer)
    address public oracleAddress;

    /// @notice Total USDC donated to the vault
    uint256 public totalDonations;

    /// @notice Total USDC released as aid
    uint256 public totalReleased;

    /// @notice Total verified impact events
    uint256 public totalEventsVerified;

    /// @notice Mapping of processed event hashes (prevents replay attacks)
    mapping(bytes32 => bool) public processedEvents;

    /// @notice Reward tier based on impact score (score × 100 → USDC wei)
    /// Example: score 80.00 → 8000 → 50 USDC reward
    mapping(uint256 => uint256) public rewardTiers;

    // ── Constructor ────────────────────────────────────────────────────────────

    constructor(
        address _stablecoin,
        address _goodToken,
        address _reputationLedger,
        address _oracleAddress,
        address _initialOwner
    ) Ownable(_initialOwner) {
        if (
            _stablecoin == address(0) ||
            _goodToken == address(0) ||
            _reputationLedger == address(0) ||
            _oracleAddress == address(0)
        ) revert BV__ZeroAddress();

        stablecoin = IERC20(_stablecoin);
        goodToken = IGoodToken(_goodToken);
        reputationLedger = IReputationLedger(_reputationLedger);
        oracleAddress = _oracleAddress;

        // Default reward tiers (USDC with 6 decimals)
        // Impact score ≥ X → reward Y USDC
        rewardTiers[9000] = 100e6;   // Score ≥ 90.00 → 100 USDC
        rewardTiers[7500] = 50e6;    // Score ≥ 75.00 →  50 USDC
        rewardTiers[5000] = 20e6;    // Score ≥ 50.00 →  20 USDC
        rewardTiers[2500] = 5e6;     // Score ≥ 25.00 →   5 USDC
        rewardTiers[0]    = 1e6;     // Score ≥ 0     →   1 USDC (participation)
    }

    // ── Donor Interface ────────────────────────────────────────────────────────

    /**
     * @notice Donors call this to deposit stablecoins into the vault.
     * @param amount Amount of stablecoin (in token units with decimals)
     */
    function donate(uint256 amount) external nonReentrant whenNotPaused {
        if (amount < MIN_DONATION) revert BV__DonationTooSmall(amount, MIN_DONATION);
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        totalDonations += amount;
        emit FundsDonated(msg.sender, amount, block.timestamp);
    }

    // ── Core: Oracle-Triggered Fund Release ───────────────────────────────────

    /**
     * @notice Submit a SATIN Oracle-signed Impact Proof to release funds.
     *
     * @param eventHash         SHA-256 hash of the canonical event data (from SATIN)
     * @param volunteerAddress  Address of the volunteer to reward
     * @param beneficiaryZKPHash  ZK-proof hash protecting beneficiary identity
     * @param impactScore       Score × 100 (e.g. 7550 = 75.50)
     * @param actionType        String identifier of the action (e.g. "FOOD_DISTRIBUTION")
     * @param oracleSignature   ECDSA signature from the SATIN Oracle
     */
    function submitVerifiedImpact(
        bytes32 eventHash,
        address volunteerAddress,
        bytes32 beneficiaryZKPHash,
        uint256 impactScore,
        string calldata actionType,
        bytes calldata oracleSignature
    ) external nonReentrant whenNotPaused {
        // ── 1. Replay protection ───────────────────────────────────────────────
        if (processedEvents[eventHash]) {
            revert BV__EventAlreadyProcessed(eventHash);
        }

        // ── 2. Input validation ────────────────────────────────────────────────
        if (volunteerAddress == address(0)) revert BV__ZeroAddress();
        if (impactScore > MAX_IMPACT_SCORE) revert BV__InvalidImpactScore(impactScore);

        // ── 3. Reconstruct the signed message (mirrors SATIN _abi_encode_message) ──
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                eventHash,
                volunteerAddress,
                beneficiaryZKPHash,
                impactScore
            )
        );

        // EIP-191: prefix with "\x19Ethereum Signed Message:\n32"
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        // ── 4. Verify oracle ECDSA signature ──────────────────────────────────
        address recoveredSigner = ethSignedHash.recover(oracleSignature);
        if (recoveredSigner != oracleAddress) {
            revert BV__UnauthorizedOracle(recoveredSigner, oracleAddress);
        }

        // ── 5. Mark as processed (CEI pattern) ────────────────────────────────
        processedEvents[eventHash] = true;
        totalEventsVerified++;

        // ── 6. Calculate reward amount ─────────────────────────────────────────
        uint256 rewardAmount = _calculateReward(impactScore);

        // ── 7. Release stablecoin reward to volunteer ──────────────────────────
        uint256 vaultBalance = stablecoin.balanceOf(address(this));
        if (vaultBalance < rewardAmount) {
            revert BV__InsufficientVaultBalance(vaultBalance, rewardAmount);
        }
        stablecoin.safeTransfer(volunteerAddress, rewardAmount);
        totalReleased += rewardAmount;

        // ── 8. Mint GOOD tokens (reputation capital) ──────────────────────────
        uint256 goodTokenAmount = (impactScore * GOOD_TOKEN_MULTIPLIER) / SCORE_PRECISION;
        goodToken.mint(volunteerAddress, goodTokenAmount);

        // ── 9. Update immutable Reputation Ledger ─────────────────────────────
        reputationLedger.recordImpact(
            volunteerAddress,
            eventHash,
            impactScore,
            actionType
        );

        uint256 newReputation = reputationLedger.getReputation(volunteerAddress);

        emit ImpactVerified(
            eventHash,
            volunteerAddress,
            beneficiaryZKPHash,
            impactScore,
            rewardAmount,
            actionType
        );
        emit ReputationUpdated(volunteerAddress, impactScore, newReputation);
    }

    // ── Internal: Reward Calculation ──────────────────────────────────────────

    /**
     * @dev Determines USDC reward based on graduated impact score tiers.
     * @param score Impact score × 100 (0 – 10000)
     */
    function _calculateReward(uint256 score) internal view returns (uint256) {
        if (score >= 9000) return rewardTiers[9000];
        if (score >= 7500) return rewardTiers[7500];
        if (score >= 5000) return rewardTiers[5000];
        if (score >= 2500) return rewardTiers[2500];
        return rewardTiers[0];
    }

    // ── View Functions ────────────────────────────────────────────────────────

    function vaultBalance() external view returns (uint256) {
        return stablecoin.balanceOf(address(this));
    }

    function isEventProcessed(bytes32 eventHash) external view returns (bool) {
        return processedEvents[eventHash];
    }

    function getVolunteerReputation(address volunteer) external view returns (uint256) {
        return reputationLedger.getReputation(volunteer);
    }

    // ── Admin Functions ───────────────────────────────────────────────────────

    /**
     * @notice Rotate the oracle address (e.g., after key compromise).
     * @dev Only callable by contract owner. Emits OracleUpdated event.
     */
    function updateOracleAddress(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert BV__ZeroAddress();
        address oldOracle = oracleAddress;
        oracleAddress = newOracle;
        emit OracleUpdated(oldOracle, newOracle);
    }

    function updateRewardTier(uint256 scoreThreshold, uint256 rewardAmount) external onlyOwner {
        rewardTiers[scoreThreshold] = rewardAmount;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Emergency withdrawal — only owner, only when paused
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner whenPaused {
        if (to == address(0)) revert BV__ZeroAddress();
        stablecoin.safeTransfer(to, amount);
        emit EmergencyWithdrawal(to, amount);
    }
}
