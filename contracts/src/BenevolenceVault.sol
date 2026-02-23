// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║          APEX HUMANITY — BenevolenceVault.sol                           ║
 * ║          Sovereign Benevolence Protocol  v2.0.0                         ║
 * ║                                                                          ║
 * ║  v2.0.0 — Native Token Minting                                          ║
 * ║  Reward volunteer langsung dengan GOOD native coin (bukan ERC-20).      ║
 * ║  Menggunakan Avalanche NativeMinter Precompile.                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import "./ReputationLedger.sol";

// ── Avalanche NativeMinter Precompile Interface ────────────────────────────────
// Address ini fixed di semua Avalanche Subnet-EVM — tidak perlu diubah
interface INativeMinter {
    function mintNativeCoin(address addr, uint256 amount) external;
}

contract BenevolenceVault is AccessControl, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;

    // ── NativeMinter Precompile Address (Avalanche Subnet-EVM) ────────────────
    INativeMinter private constant NATIVE_MINTER =
        INativeMinter(0x0200000000000000000000000000000000000001);

    // ── Roles ─────────────────────────────────────────────────────────────────
    bytes32 public constant ORACLE_ROLE    = keccak256("ORACLE_ROLE");
    bytes32 public constant DAO_ADMIN_ROLE = keccak256("DAO_ADMIN_ROLE");

    // ── State Variables ───────────────────────────────────────────────────────
    ReputationLedger public immutable reputationLedger;
    address public oracleAddress;

    uint256 public totalFundsDistributed;
    uint256 public totalEventsVerified;
    uint256 public minImpactScoreToRelease = 3000; // 30.00 scaled ×100

    // ── Anti-Replay Protection ────────────────────────────────────────────────
    mapping(bytes32 => bool) private _usedEventIds;
    mapping(string  => bool) private _usedNonces;

    // ── Events ────────────────────────────────────────────────────────────────
    event RewardReleased(
        bytes32 indexed eventId,
        address indexed volunteer,
        address indexed beneficiary,
        uint256 impactScore,
        uint256 tokenReward,     // GOOD native coin amount in wei
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

    // ── Errors ────────────────────────────────────────────────────────────────
    error InvalidOracleSignature();
    error EventAlreadyProcessed(bytes32 eventId);
    error NonceAlreadyUsed(string nonce);
    error PayloadExpired(uint256 expiredAt, uint256 currentTime);
    error ScoreBelowMinimum(uint256 score, uint256 minimum);
    error InvalidAddress();
    error ZeroAmount();
    error NativeMintFailed();

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address _reputationLedger,
        address _oracleAddress,
        address _daoAdmin
    ) {
        if (_reputationLedger == address(0)) revert InvalidAddress();
        if (_oracleAddress    == address(0)) revert InvalidAddress();

        reputationLedger = ReputationLedger(_reputationLedger);
        oracleAddress    = _oracleAddress;

        _grantRole(DEFAULT_ADMIN_ROLE, _daoAdmin);
        _grantRole(DAO_ADMIN_ROLE,     _daoAdmin);
        _grantRole(ORACLE_ROLE,        _oracleAddress);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  CORE: RELEASE REWARD — Mint GOOD native coin langsung ke volunteer
    // ══════════════════════════════════════════════════════════════════════════

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
        if (volunteerAddress   == address(0)) revert InvalidAddress();
        if (beneficiaryAddress == address(0)) revert InvalidAddress();
        if (tokenRewardWei     == 0)          revert ZeroAmount();

        if (_usedEventIds[eventId])   revert EventAlreadyProcessed(eventId);
        if (_usedNonces[nonce])       revert NonceAlreadyUsed(nonce);
        if (block.timestamp > expiresAt) revert PayloadExpired(expiresAt, block.timestamp);
        if (impactScoreScaled < minImpactScoreToRelease)
            revert ScoreBelowMinimum(impactScoreScaled, minImpactScoreToRelease);

        // ── Verify Oracle Signature ───────────────────────────────────────────
        bytes32 signingHash = _buildSigningHash(
            eventId, volunteerAddress, beneficiaryAddress,
            impactScoreScaled, tokenRewardWei,
            zkProofHash, eventHash, nonce, expiresAt
        );
        address recovered = MessageHashUtils
            .toEthSignedMessageHash(signingHash)
            .recover(v, r, s);
        if (recovered != oracleAddress) revert InvalidOracleSignature();

        // ── Mark as Processed (anti-replay) ──────────────────────────────────
        _usedEventIds[eventId] = true;
        _usedNonces[nonce]     = true;

        // ── Mint GOOD native coin langsung ke volunteer ───────────────────────
        // Ini pakai Avalanche NativeMinter Precompile — bukan ERC-20 lagi!
        // GOOD yang di-mint ini = koin utama APEX Network, bisa langsung:
        //   ✅ Bayar gas fee
        //   ✅ Transfer ke orang lain
        //   ✅ Untuk voting governance
        //   ✅ Langsung muncul di MetaMask sebagai main balance
        NATIVE_MINTER.mintNativeCoin(volunteerAddress, tokenRewardWei);

        // ── Update Reputation Ledger ──────────────────────────────────────────
        uint256 newRepScore = reputationLedger.updateReputation(
            volunteerAddress,
            impactScoreScaled
        );

        // ── Update Stats ──────────────────────────────────────────────────────
        totalFundsDistributed += tokenRewardWei;
        totalEventsVerified   += 1;

        // ── Emit Events ───────────────────────────────────────────────────────
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
    //  GOVERNANCE
    // ══════════════════════════════════════════════════════════════════════════

    function setOracleAddress(address newOracle) external onlyRole(DAO_ADMIN_ROLE) {
        if (newOracle == address(0)) revert InvalidAddress();
        address old = oracleAddress;
        _revokeRole(ORACLE_ROLE, old);
        _grantRole(ORACLE_ROLE, newOracle);
        oracleAddress = newOracle;
        emit OracleAddressUpdated(old, newOracle);
    }

    function setMinImpactScore(uint256 newMin) external onlyRole(DAO_ADMIN_ROLE) {
        emit MinScoreUpdated(minImpactScoreToRelease, newMin);
        minImpactScoreToRelease = newMin;
    }

    function pause()   external onlyRole(DAO_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DAO_ADMIN_ROLE) { _unpause(); }

    // ══════════════════════════════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ══════════════════════════════════════════════════════════════════════════

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
        // deposited = 0 (tidak ada escrow lagi, langsung mint)
        return (0, totalFundsDistributed, totalEventsVerified, address(this).balance);
    }

    // ── Receive native coin donations ─────────────────────────────────────────
    receive() external payable {}

    // ══════════════════════════════════════════════════════════════════════════
    //  INTERNAL
    // ══════════════════════════════════════════════════════════════════════════

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
