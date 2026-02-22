// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GoodToken (GOOD) — APEX HUMANITY Protocol
 * @notice ERC-20 Impact Token — the currency of human kindness.
 *
 *   Symbol:   GOOD
 *   Decimals: 18
 *   Supply:   Uncapped (minted only by BenevolenceVault upon verified impact)
 *
 *   GOOD tokens represent Reputation Capital:
 *   - Can be traded on DEXes (liquidity = market value of kindness)
 *   - Used for governance voting in APEX DAO
 *   - Can be burned to boost a beneficiary allocation
 *   - Non-inflationary baseline: only minted for VERIFIED actions
 */

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

error GOOD__OnlyMinterRole();
error GOOD__ExceedsMintCap(uint256 requested, uint256 cap);

contract GoodToken is ERC20Burnable, ERC20Votes, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // Max tokens minted per event (safety cap)
    uint256 public constant MAX_MINT_PER_EVENT = 100_000 ether;

    event MinterAdded(address indexed minter);
    event MinterRevoked(address indexed minter);

    constructor(address admin) 
        ERC20("Good Token", "GOOD") 
        ERC20Permit("Good Token") 
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (amount > MAX_MINT_PER_EVENT) {
            revert GOOD__ExceedsMintCap(amount, MAX_MINT_PER_EVENT);
        }
        _mint(to, amount);
    }

    function addMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(MINTER_ROLE, minter);
        emit MinterAdded(minter);
    }

    function revokeMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, minter);
        emit MinterRevoked(minter);
    }

    // Required overrides for ERC20Votes
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
