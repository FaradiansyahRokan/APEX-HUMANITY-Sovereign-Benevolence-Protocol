// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * APEX HUMANITY — SovereignID.sol
 * Soulbound Digital Identity NFT (inspired by ERC-5114 / ERC-4973).
 * Each wallet can hold exactly ONE SovereignID.
 * It cannot be transferred, sold, or delegated — it IS the person.
 */

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

interface IReputationLedger {
    function getReputation(address volunteer) external view returns (
        uint256 cumulativeScore, uint256 eventCount, uint256 lastUpdatedAt, uint256 rank
    );
}

contract SovereignID is AccessControl {
    using Strings for uint256;

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    struct Identity {
        uint256 tokenId;
        string  didDocument;         // IPFS CID of W3C DID document
        string  countryIso;          // ISO 3166-1 alpha-2
        uint256 issuedAt;
        bool    isActive;
        bool    isVerifiedHuman;     // Worldcoin / Proof-of-Humanity verified
    }

    uint256 private _tokenIdCounter;
    IReputationLedger public reputationLedger;

    mapping(address  => Identity)  private _identities;
    mapping(uint256  => address)   private _tokenOwner;
    mapping(address  => bool)      public  hasIdentity;

    event IdentityIssued(
        address indexed owner, uint256 indexed tokenId, string didDocument, uint256 timestamp
    );
    event IdentityRevoked(address indexed owner, uint256 indexed tokenId, uint256 timestamp);
    event HumanVerified(address indexed owner, uint256 timestamp);

    error AlreadyHasIdentity(address owner);
    error NoIdentityFound(address owner);
    error SoulboundTransferForbidden();

    constructor(address admin, address _reputationLedger) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
        reputationLedger = IReputationLedger(_reputationLedger);
    }

    /**
     * @notice Issue a SovereignID to a new participant.
     * @param owner       Wallet address of the participant
     * @param didDocument IPFS CID containing the W3C DID document
     * @param countryIso  ISO country code for the participant
     */
    function issueIdentity(
        address owner,
        string calldata didDocument,
        string calldata countryIso
    ) external onlyRole(ISSUER_ROLE) {
        if (hasIdentity[owner]) revert AlreadyHasIdentity(owner);

        uint256 tokenId = ++_tokenIdCounter;
        _identities[owner] = Identity({
            tokenId:         tokenId,
            didDocument:     didDocument,
            countryIso:      countryIso,
            issuedAt:        block.timestamp,
            isActive:        true,
            isVerifiedHuman: false
        });
        _tokenOwner[tokenId] = owner;
        hasIdentity[owner]   = true;

        emit IdentityIssued(owner, tokenId, didDocument, block.timestamp);
    }

    function markHumanVerified(address owner) external onlyRole(ISSUER_ROLE) {
        if (!hasIdentity[owner]) revert NoIdentityFound(owner);
        _identities[owner].isVerifiedHuman = true;
        emit HumanVerified(owner, block.timestamp);
    }

    function revokeIdentity(address owner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!hasIdentity[owner]) revert NoIdentityFound(owner);
        _identities[owner].isActive = false;
        emit IdentityRevoked(owner, _identities[owner].tokenId, block.timestamp);
    }

    function getIdentity(address owner) external view returns (Identity memory) {
        if (!hasIdentity[owner]) revert NoIdentityFound(owner);
        return _identities[owner];
    }

    /**
     * @notice Returns the full sovereign profile: identity + reputation.
     */
    function getSovereignProfile(address owner) external view returns (
        Identity memory identity,
        uint256 cumulativeScore,
        uint256 eventCount,
        uint256 rank
    ) {
        identity = _identities[owner];
        (cumulativeScore, eventCount,, rank) = reputationLedger.getReputation(owner);
    }

    function totalIdentities() external view returns (uint256) {
        return _tokenIdCounter;
    }

    // ── Soulbound: Transfers are FORBIDDEN ───────────────────────────────────
    function transfer(address, uint256) public pure {
        revert SoulboundTransferForbidden();
    }
    function transferFrom(address, address, uint256) public pure {
        revert SoulboundTransferForbidden();
    }
    function approve(address, uint256) public pure {
        revert SoulboundTransferForbidden();
    }
}
