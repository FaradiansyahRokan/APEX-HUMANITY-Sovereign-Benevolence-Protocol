/**
 * APEX HUMANITY — SovereignID Tests
 * Hardhat + Chai test suite  v1.0.0
 *
 * Coverage:
 *   - issueIdentity() happy path + duplicate guard
 *   - markHumanVerified()
 *   - revokeIdentity()
 *   - getIdentity() / getSovereignProfile()
 *   - Soulbound: transfer/approve all revert
 *   - Access control
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("SovereignID", function () {
    let sovereignID, reputationLedger;
    let admin, issuer, volunteer, volunteer2, stranger;

    const DID_DOC = "ipfs://QmTestDIDDocument";
    const COUNTRY = "ID";

    beforeEach(async () => {
        [admin, issuer, volunteer, volunteer2, stranger] = await ethers.getSigners();

        // Deploy ReputationLedger first (SovereignID reads from it)
        const LedgerFactory = await ethers.getContractFactory("ReputationLedger");
        reputationLedger = await LedgerFactory.deploy(admin.address);

        // Deploy SovereignID
        const SIDFactory = await ethers.getContractFactory("SovereignID");
        sovereignID = await SIDFactory.deploy(admin.address, await reputationLedger.getAddress());

        // Grant ISSUER_ROLE to issuer
        await sovereignID.grantRole(await sovereignID.ISSUER_ROLE(), issuer.address);
    });

    // ── Issue Identity ─────────────────────────────────────────────────────────

    describe("issueIdentity()", () => {
        it("should issue a SovereignID for a new address", async () => {
            await sovereignID.connect(issuer).issueIdentity(volunteer.address, DID_DOC, COUNTRY);
            expect(await sovereignID.hasIdentity(volunteer.address)).to.be.true;
        });

        it("should increment tokenId counter", async () => {
            await sovereignID.connect(issuer).issueIdentity(volunteer.address, DID_DOC, COUNTRY);
            await sovereignID.connect(issuer).issueIdentity(volunteer2.address, DID_DOC, "US");
            expect(await sovereignID.totalIdentities()).to.equal(2n);
        });

        it("should store correct identity fields", async () => {
            await sovereignID.connect(issuer).issueIdentity(volunteer.address, DID_DOC, COUNTRY);
            const identity = await sovereignID.getIdentity(volunteer.address);
            expect(identity.didDocument).to.equal(DID_DOC);
            expect(identity.countryIso).to.equal(COUNTRY);
            expect(identity.isActive).to.be.true;
            expect(identity.isVerifiedHuman).to.be.false;
        });

        it("should emit IdentityIssued event", async () => {
            await expect(
                sovereignID.connect(issuer).issueIdentity(volunteer.address, DID_DOC, COUNTRY)
            ).to.emit(sovereignID, "IdentityIssued").withArgs(
                volunteer.address, 1n, DID_DOC, anyValue
            );
        });

        it("should revert on duplicate identity (one wallet = one SovereignID)", async () => {
            await sovereignID.connect(issuer).issueIdentity(volunteer.address, DID_DOC, COUNTRY);
            await expect(
                sovereignID.connect(issuer).issueIdentity(volunteer.address, DID_DOC, COUNTRY)
            ).to.be.revertedWithCustomError(sovereignID, "AlreadyHasIdentity");
        });

        it("should revert if called by non-ISSUER_ROLE", async () => {
            await expect(
                sovereignID.connect(stranger).issueIdentity(volunteer.address, DID_DOC, COUNTRY)
            ).to.be.reverted;
        });
    });

    // ── Human Verification ─────────────────────────────────────────────────────

    describe("markHumanVerified()", () => {
        beforeEach(async () => {
            await sovereignID.connect(issuer).issueIdentity(volunteer.address, DID_DOC, COUNTRY);
        });

        it("should mark isVerifiedHuman = true", async () => {
            await sovereignID.connect(issuer).markHumanVerified(volunteer.address);
            const identity = await sovereignID.getIdentity(volunteer.address);
            expect(identity.isVerifiedHuman).to.be.true;
        });

        it("should emit HumanVerified event", async () => {
            await expect(
                sovereignID.connect(issuer).markHumanVerified(volunteer.address)
            ).to.emit(sovereignID, "HumanVerified").withArgs(volunteer.address, anyValue);
        });

        it("should revert if address has no identity", async () => {
            await expect(
                sovereignID.connect(issuer).markHumanVerified(stranger.address)
            ).to.be.revertedWithCustomError(sovereignID, "NoIdentityFound");
        });
    });

    // ── Revocation ─────────────────────────────────────────────────────────────

    describe("revokeIdentity()", () => {
        beforeEach(async () => {
            await sovereignID.connect(issuer).issueIdentity(volunteer.address, DID_DOC, COUNTRY);
        });

        it("should set isActive = false", async () => {
            await sovereignID.connect(admin).revokeIdentity(volunteer.address);
            const identity = await sovereignID.getIdentity(volunteer.address);
            expect(identity.isActive).to.be.false;
        });

        it("should emit IdentityRevoked event", async () => {
            await expect(
                sovereignID.connect(admin).revokeIdentity(volunteer.address)
            ).to.emit(sovereignID, "IdentityRevoked").withArgs(
                volunteer.address, 1n, anyValue
            );
        });

        it("should revert if address has no identity", async () => {
            await expect(
                sovereignID.connect(admin).revokeIdentity(stranger.address)
            ).to.be.revertedWithCustomError(sovereignID, "NoIdentityFound");
        });

        it("non-admin cannot revoke", async () => {
            await expect(
                sovereignID.connect(issuer).revokeIdentity(volunteer.address)
            ).to.be.reverted;
        });
    });

    // ── getSovereignProfile ────────────────────────────────────────────────────

    describe("getSovereignProfile()", () => {
        it("should bundle identity + reputation in one call", async () => {
            await sovereignID.connect(issuer).issueIdentity(volunteer.address, DID_DOC, COUNTRY);
            const [identity, cumulative, eventCount, rank] =
                await sovereignID.getSovereignProfile(volunteer.address);
            expect(identity.didDocument).to.equal(DID_DOC);
            expect(cumulative).to.equal(0n);     // no reputation events yet
            expect(eventCount).to.equal(0n);
            expect(rank).to.equal(0n);
        });
    });

    // ── Soulbound: Transfers Forbidden ────────────────────────────────────────

    describe("Soulbound — transferability", () => {
        it("transfer() always reverts", async () => {
            await expect(
                sovereignID.transfer(volunteer.address, 1)
            ).to.be.revertedWithCustomError(sovereignID, "SoulboundTransferForbidden");
        });

        it("transferFrom() always reverts", async () => {
            await expect(
                sovereignID.transferFrom(admin.address, volunteer.address, 1)
            ).to.be.revertedWithCustomError(sovereignID, "SoulboundTransferForbidden");
        });

        it("approve() always reverts", async () => {
            await expect(
                sovereignID.approve(volunteer.address, 1)
            ).to.be.revertedWithCustomError(sovereignID, "SoulboundTransferForbidden");
        });
    });

    // ── getIdentity() on unknown address ──────────────────────────────────────

    describe("getIdentity() error handling", () => {
        it("should revert NoIdentityFound for unknown address", async () => {
            await expect(
                sovereignID.getIdentity(stranger.address)
            ).to.be.revertedWithCustomError(sovereignID, "NoIdentityFound");
        });
    });
});

async function latestTimestamp() {
    return (await ethers.provider.getBlock("latest")).timestamp;
}
