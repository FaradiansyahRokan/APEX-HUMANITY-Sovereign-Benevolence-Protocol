// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║          APEX HUMANITY — BenevolenceVault.sol                           ║
 * ║          Sovereign Benevolence Protocol  v2.1.0                         ║
 * ║                                                                          ║
 * ║  v2.0.0 — Native Token Minting via Avalanche NativeMinter Precompile   ║
 * ║  v2.1.0 — Security patches:                                             ║
 * ║    • abi.encode replaces abi.encodePacked (hash-collision fix)          ║
 * ║    • SovereignID opt-in guard added                                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import "./ReputationLedger.sol";

// ── Avalanche NativeMinter Precompile Interface ────────────────────────────────
interface INativeMinter {
    function mintNativeCoin(address addr, uint256 amount) external;
}

// ── Minimal SovereignID Interface ─────────────────────────────────────────────
interface ISovereignID {
    function hasIdentity(address owner) external view returns (bool);
    function getIdentity(address owner) external view returns (
        uint256 tokenId,
        string memory didDocument,
        string memory countryIso,
        uint256 issuedAt,
        bool isActive,
        bool isVerifiedHuman
    );
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

    // ── SovereignID Integration (opt-in) ──────────────────────────────────────
    ISovereignID public sovereignIDContract;
    bool public requireSovereignID = false; // DAO can enable when SovereignID is live

    // ── Anti-Replay Protection ────────────────────────────────────────────────
    mapping(bytes32 => bool) private _usedEventIds;
    mapping(bytes32 => bool) private _usedNonces; // FIX: bytes32 keccak of nonce (not raw string)

    // ── Events ────────────────────────────────────────────────────────────────
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
    event SovereignIDConfigUpdated(address indexed contractAddress, bool required);

    // ── Errors ────────────────────────────────────────────────────────────────
    error InvalidOracleSignature();
    error EventAlreadyProcessed(bytes32 eventId);
    error NonceAlreadyUsed(bytes32 nonceHash);
    error PayloadExpired(uint256 expiredAt, uint256 currentTime);
    error ScoreBelowMinimum(uint256 score, uint256 minimum);
    error InvalidAddress();
    error ZeroAmount();
    error NativeMintFailed();
    error NoSovereignID(address volunteer);
    error SovereignIDRevoked(address volunteer);

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
    //  CORE: RELEASE REWARD
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

        if (_usedEventIds[eventId]) revert EventAlreadyProcessed(eventId);

        bytes32 nonceHash = keccak256(bytes(nonce));
        if (_usedNonces[nonceHash]) revert NonceAlreadyUsed(nonceHash);

        if (block.timestamp > expiresAt) revert PayloadExpired(expiresAt, block.timestamp);
        if (impactScoreScaled < minImpactScoreToRelease)
            revert ScoreBelowMinimum(impactScoreScaled, minImpactScoreToRelease);

        // ── SovereignID Guard (opt-in) ────────────────────────────────────────
        if (requireSovereignID && address(sovereignIDContract) != address(0)) {
            if (!sovereignIDContract.hasIdentity(volunteerAddress))
                revert NoSovereignID(volunteerAddress);
            (,,,, bool isActive,) = sovereignIDContract.getIdentity(volunteerAddress);
            if (!isActive) revert SovereignIDRevoked(volunteerAddress);
        }

        // ── Verify Oracle Signature ───────────────────────────────────────────
        // FIX v2.1.0: Uses abi.encode (not abi.encodePacked) to prevent
        // hash-collision attacks from adjacent dynamic types (string nonce).
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
        _usedEventIds[eventId]  = true;
        _usedNonces[nonceHash]  = true;

        // ── Mint APEX native coin to volunteer ────────────────────────────────
        NATIVE_MINTER.mintNativeCoin(volunteerAddress, tokenRewardWei);

        // ── Update Reputation Ledger ──────────────────────────────────────────
        // v2.2.0: pass eventHash so each ScoreEntry has a real event fingerprint
        uint256 newRepScore = reputationLedger.updateReputation(
            volunteerAddress,
            impactScoreScaled,
            eventHash
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

    /// @notice Configure the SovereignID integration.
    /// @param _contract Address of deployed SovereignID.sol (use address(0) to disable).
    /// @param _required If true, volunteers MUST have an active SovereignID to claim rewards.
    function setSovereignIDConfig(
        address _contract,
        bool    _required
    ) external onlyRole(DAO_ADMIN_ROLE) {
        sovereignIDContract = ISovereignID(_contract);
        requireSovereignID  = _required;
        emit SovereignIDConfigUpdated(_contract, _required);
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
        return _usedNonces[keccak256(bytes(nonce))];
    }

    function getStats() external view returns (
        uint256 deposited,
        uint256 distributed,
        uint256 eventsVerified,
        uint256 currentBalance
    ) {
        return (0, totalFundsDistributed, totalEventsVerified, address(this).balance);
    }

    // ── Receive native coin donations ─────────────────────────────────────────
    receive() external payable {}

    // ══════════════════════════════════════════════════════════════════════════
    //  INTERNAL
    // ══════════════════════════════════════════════════════════════════════════

    /// @dev FIX v2.1.0 — uses abi.encode (not abi.encodePacked) to prevent hash
    /// collision attacks.  abi.encode pads every type to 32-byte slots so two
    /// different (a, b) pairs can never produce the same packed bytes.
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
        return keccak256(abi.encode(
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
