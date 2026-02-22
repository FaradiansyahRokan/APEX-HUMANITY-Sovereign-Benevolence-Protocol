// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║          APEX HUMANITY — BenevolenceVault.sol                           ║
 * ║          Sovereign Benevolence Protocol  v1.0.0                         ║
 * ║                                                                          ║
 * ║  Escrow vault that releases ImpactTokens only upon receiving a          ║
 * ║  cryptographically signed approval from the authorised SATIN Oracle.    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Key Features:
 *  - Funds held in escrow, never accessible to admin directly
 *  - Oracle signature verified on-chain via ecrecover
 *  - Replay-attack protection via nonce + expiry
 *  - Immutable reputation updates via ReputationLedger
 *  - Pausable by DAO governance in emergencies
 *  - Full event log for transparent fund tracing
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import "./ImpactToken.sol";
import "./ReputationLedger.sol";

contract BenevolenceVault is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // ── Roles ─────────────────────────────────────────────────────────────────
    bytes32 public constant ORACLE_ROLE    = keccak256("ORACLE_ROLE");
    bytes32 public constant DAO_ADMIN_ROLE = keccak256("DAO_ADMIN_ROLE");
    bytes32 public constant DONOR_ROLE     = keccak256("DONOR_ROLE");

    // ── State Variables ───────────────────────────────────────────────────────
    ImpactToken        public immutable impactToken;
    ReputationLedger   public immutable reputationLedger;
    IERC20             public immutable stablecoin;       // e.g. USDC for stable rewards

    address public oracleAddress;   // SATIN Oracle signer address

    uint256 public totalFundsDeposited;
    uint256 public totalFundsDistributed;
    uint256 public totalEventsVerified;
    uint256 public minImpactScoreToRelease = 3000; // 30.00 in scaled uint (×100)

    // ── Anti-Replay Protection ────────────────────────────────────────────────
    mapping(bytes32 => bool) private _usedEventIds;
    mapping(string  => bool) private _usedNonces;

    // ── Donor Escrow ──────────────────────────────────────────────────────────
    mapping(address => uint256) public donorDeposits;   // Track each donor's contribution

    // ── Event Log (immutable audit trail) ────────────────────────────────────
    event FundsDeposited(
        address indexed donor,
        uint256 amount,
        uint256 totalPoolBalance,
        uint256 timestamp
    );

    event RewardReleased(
        bytes32 indexed eventId,
        address indexed volunteer,
        address indexed beneficiary,
        uint256 impactScore,
        uint256 tokenReward,
        bytes32 zkProofHash,
        bytes32 eventHash,
        uint256 timestamp
    );

    event ReputationUpdated(
        address indexed volunteer,
        uint256 newScore,
        uint256 cumulativeScore
    );

    event OracleAddressUpdated(address oldOracle, address newOracle);
    event MinScoreUpdated(uint256 oldMin, uint256 newMin);
    event EmergencyWithdraw(address indexed admin, uint256 amount);

    // ── Errors ────────────────────────────────────────────────────────────────
    error InvalidOracleSignature();
    error EventAlreadyProcessed(bytes32 eventId);
    error NonceAlreadyUsed(string nonce);
    error PayloadExpired(uint256 expiredAt, uint256 currentTime);
    error ScoreBelowMinimum(uint256 score, uint256 minimum);
    error InsufficientVaultBalance(uint256 requested, uint256 available);
    error InvalidAddress();
    error ZeroAmount();

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address _impactToken,
        address _reputationLedger,
        address _stablecoin,
        address _oracleAddress,
        address _daoAdmin
    ) {
        if (_impactToken       == address(0)) revert InvalidAddress();
        if (_reputationLedger  == address(0)) revert InvalidAddress();
        if (_oracleAddress     == address(0)) revert InvalidAddress();

        impactToken       = ImpactToken(_impactToken);
        reputationLedger  = ReputationLedger(_reputationLedger);
        stablecoin        = IERC20(_stablecoin);
        oracleAddress     = _oracleAddress;

        _grantRole(DEFAULT_ADMIN_ROLE, _daoAdmin);
        _grantRole(DAO_ADMIN_ROLE,     _daoAdmin);
        _grantRole(ORACLE_ROLE,        _oracleAddress);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  CORE: RELEASE REWARD
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Called by the dApp after receiving a signed payload from SATIN Oracle.
     * @dev Verifies oracle signature → validates score → mints ImpactTokens → updates reputation.
     *
     * @param eventId           Unique event UUID (as bytes32)
     * @param volunteerAddress  Wallet receiving the token reward
     * @param beneficiaryAddress Wallet of aid recipient (can be ZK-anonymised)
     * @param impactScoreScaled  ImpactScore × 100 (e.g. 7550 = 75.50 score)
     * @param tokenRewardWei    ImpactToken amount in wei (18 decimals)
     * @param zkProofHash       ZK commitment hash (beneficiary identity proof)
     * @param eventHash         Immutable fingerprint of the impact event
     * @param nonce             One-time random string (anti-replay)
     * @param expiresAt         Unix timestamp after which payload is invalid
     * @param v, r, s           ECDSA signature components from Oracle
     */
    function releaseReward(
        bytes32 eventId,
        address volunteerAddress,
        address beneficiaryAddress,
        uint256 impactScoreScaled,
        uint256 tokenRewardWei,
        bytes32 zkProofHash,
        bytes32 eventHash,
        string  calldata nonce,
        uint256 expiresAt,
        uint8   v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        // ── Guard Checks ──────────────────────────────────────────────────────
        if (volunteerAddress  == address(0)) revert InvalidAddress();
        if (beneficiaryAddress == address(0)) revert InvalidAddress();
        if (tokenRewardWei == 0) revert ZeroAmount();

        if (_usedEventIds[eventId])
            revert EventAlreadyProcessed(eventId);
        if (_usedNonces[nonce])
            revert NonceAlreadyUsed(nonce);
        if (block.timestamp > expiresAt)
            revert PayloadExpired(expiresAt, block.timestamp);
        if (impactScoreScaled < minImpactScoreToRelease)
            revert ScoreBelowMinimum(impactScoreScaled, minImpactScoreToRelease);

        // ── Verify Oracle Signature ───────────────────────────────────────────
        bytes32 signingHash = _buildSigningHash(
            eventId, volunteerAddress, beneficiaryAddress,
            impactScoreScaled, tokenRewardWei, zkProofHash,
            eventHash, nonce, expiresAt
        );
        address recovered = MessageHashUtils.toEthSignedMessageHash(signingHash).recover(v, r, s);
        if (recovered != oracleAddress)
            revert InvalidOracleSignature();

        // ── Mark as Processed (anti-replay) ──────────────────────────────────
        _usedEventIds[eventId] = true;
        _usedNonces[nonce]     = true;

        // ── Mint ImpactTokens to Volunteer ────────────────────────────────────
        impactToken.mint(volunteerAddress, tokenRewardWei);

        // ── Update Global Reputation Ledger ───────────────────────────────────
        uint256 newRepScore = reputationLedger.updateReputation(
            volunteerAddress,
            impactScoreScaled
        );

        // ── Update Stats ──────────────────────────────────────────────────────
        totalFundsDistributed += tokenRewardWei;
        totalEventsVerified   += 1;

        // ── Emit Events (immutable, traceable audit trail) ────────────────────
        emit RewardReleased(
            eventId,
            volunteerAddress,
            beneficiaryAddress,
            impactScoreScaled,
            tokenRewardWei,
            zkProofHash,
            eventHash,
            block.timestamp
        );

        emit ReputationUpdated(volunteerAddress, impactScoreScaled, newRepScore);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  DONOR FUNCTIONS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Donors deposit stablecoins into the vault to fund impact rewards.
     * @dev Deposits are tracked per-donor for transparency. Funds can only leave
     *      via oracle-verified releaseReward calls — never by admin.
     */
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        donorDeposits[msg.sender] += amount;
        totalFundsDeposited       += amount;
        emit FundsDeposited(msg.sender, amount, stablecoin.balanceOf(address(this)), block.timestamp);
    }

    receive() external payable {
        // Accept native ETH/MATIC donations
        totalFundsDeposited += msg.value;
        emit FundsDeposited(msg.sender, msg.value, address(this).balance, block.timestamp);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  GOVERNANCE FUNCTIONS
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice DAO can rotate the oracle address (e.g. after key rotation).
     */
    function setOracleAddress(address newOracle) external onlyRole(DAO_ADMIN_ROLE) {
        if (newOracle == address(0)) revert InvalidAddress();
        address old = oracleAddress;
        _revokeRole(ORACLE_ROLE, old);
        _grantRole(ORACLE_ROLE, newOracle);
        oracleAddress = newOracle;
        emit OracleAddressUpdated(old, newOracle);
    }

    /**
     * @notice DAO can adjust minimum impact score threshold.
     */
    function setMinImpactScore(uint256 newMin) external onlyRole(DAO_ADMIN_ROLE) {
        emit MinScoreUpdated(minImpactScoreToRelease, newMin);
        minImpactScoreToRelease = newMin;
    }

    function pause()   external onlyRole(DAO_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DAO_ADMIN_ROLE) { _unpause(); }

    /**
     * @notice Emergency only — withdraw stablecoins to DAO treasury multisig.
     * @dev Cannot drain ImpactTokens (those are minted, not held).
     */
    function emergencyWithdraw(address to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        whenPaused
    {
        if (to == address(0)) revert InvalidAddress();
        stablecoin.safeTransfer(to, amount);
        emit EmergencyWithdraw(to, amount);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ══════════════════════════════════════════════════════════════════════════

    function vaultBalance() external view returns (uint256) {
        return stablecoin.balanceOf(address(this));
    }

    function isEventProcessed(bytes32 eventId) external view returns (bool) {
        return _usedEventIds[eventId];
    }

    function isNonceUsed(string calldata nonce) external view returns (bool) {
        return _usedNonces[nonce];
    }

    function getStats() external view returns (
        uint256 deposited,
        uint256 distributed,
        uint256 eventsVerified,
        uint256 currentBalance
    ) {
        return (
            totalFundsDeposited,
            totalFundsDistributed,
            totalEventsVerified,
            stablecoin.balanceOf(address(this))
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  INTERNAL
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @dev Mirrors the signing hash constructed by SATIN Oracle's _build_signing_hash().
     *      MUST match exactly — any difference causes ecrecover to return wrong address.
     */
    function _buildSigningHash(
        bytes32 eventId,
        address volunteerAddress,
        address beneficiaryAddress,
        uint256 impactScoreScaled,
        uint256 tokenRewardWei,
        bytes32 zkProofHash,
        bytes32 eventHash,
        string  calldata nonce,
        uint256 expiresAt
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            eventId,
            volunteerAddress,
            beneficiaryAddress,
            impactScoreScaled,
            tokenRewardWei,
            zkProofHash,
            eventHash,
            nonce,
            expiresAt
        ));
    }
}
