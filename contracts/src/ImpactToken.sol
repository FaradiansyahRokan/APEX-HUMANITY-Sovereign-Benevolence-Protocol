// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * APEX HUMANITY — ImpactToken.sol
 * ERC-20 token minted as reward for verified beneficial actions.
 * Ticker: APEX | Only mintable by authorised BenevolenceVault contracts.
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract ImpactToken is ERC20, ERC20Permit, ERC20Votes, AccessControl {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**18; // 1 Billion APEX

    uint256 public totalMinted;
    uint256 public totalBurned;

    event TokensMinted(address indexed to, uint256 amount, uint256 totalMinted);
    event TokensBurned(address indexed from, uint256 amount, uint256 totalBurned);

    error MaxSupplyExceeded(uint256 requested, uint256 remaining);

    constructor(address admin)
        ERC20("APEX Impact Token", "APEX")
        ERC20Permit("APEX Impact Token")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /**
     * @notice Mint new APEX tokens. Only callable by BenevolenceVault (MINTER_ROLE).
     * @dev Supply is strictly capped. Governance can vote to adjust MAX_SUPPLY
     *      via a contract upgrade after community vote.
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (totalMinted + amount > MAX_SUPPLY)
            revert MaxSupplyExceeded(amount, MAX_SUPPLY - totalMinted);
        totalMinted += amount;
        _mint(to, amount);
        emit TokensMinted(to, amount, totalMinted);
    }

    function burn(uint256 amount) external onlyRole(BURNER_ROLE) {
        totalBurned += amount;
        _burn(msg.sender, amount);
        emit TokensBurned(msg.sender, amount, totalBurned);
    }

    function circulatingSupply() external view returns (uint256) {
        return totalMinted - totalBurned;
    }

    // ── ERC20Votes overrides ──────────────────────────────────────────────────
    function _update(address from, address to, uint256 value)
        internal override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public view override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
