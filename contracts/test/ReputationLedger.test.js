/**
 * APEX HUMANITY — ReputationLedger Tests
 * Hardhat + Chai test suite  v1.2.0
 *
 * Coverage:
 *   - updateReputation() with real eventHash
 *   - All 9 badge milestone conditions
 *   - updateRanks() governance (KEEPER_ROLE)
 *   - getLeaderboardPage() pagination
 *   - banAddress() / unbanAddress() moderation
 *   - Access control enforcement
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("ReputationLedger", function () {
    let ledger;
    let admin, vault, keeper, volunteer, volunteer2, stranger;

    const EVENT_HASH_1 = ethers.id("event-001");
    const EVENT_HASH_2 = ethers.id("event-002");

    beforeEach(async () => {
        [admin, vault, keeper, volunteer, volunteer2, stranger] =
            await ethers.getSigners();

        const Factory = await ethers.getContractFactory("ReputationLedger");
        ledger = await Factory.deploy(admin.address);

        // Grant vault role so we can call updateReputation
        await ledger.grantRole(await ledger.VAULT_ROLE(), vault.address);
        // Grant keeper role separately
        await ledger.grantRole(await ledger.KEEPER_ROLE(), keeper.address);
    });

    // ── Reputation Updates ─────────────────────────────────────────────────────

    describe("updateReputation()", () => {
        it("should update cumulativeScore and eventCount", async () => {
            await ledger.connect(vault).updateReputation(volunteer.address, 5000, EVENT_HASH_1);
            const [cumulative, eventCount] = await ledger.getReputation(volunteer.address);
            expect(cumulative).to.equal(5000n);
            expect(eventCount).to.equal(1n);
        });

        it("should accumulate across multiple events", async () => {
            await ledger.connect(vault).updateReputation(volunteer.address, 3000, EVENT_HASH_1);
            await ledger.connect(vault).updateReputation(volunteer.address, 4500, EVENT_HASH_2);
            const [cumulative, eventCount] = await ledger.getReputation(volunteer.address);
            expect(cumulative).to.equal(7500n);
            expect(eventCount).to.equal(2n);
        });

        it("should store the real eventHash in score history", async () => {
            await ledger.connect(vault).updateReputation(volunteer.address, 5000, EVENT_HASH_1);
            const history = await ledger.getScoreHistory(volunteer.address);
            expect(history.length).to.equal(1);
            expect(history[0].eventHash).to.equal(EVENT_HASH_1);
            expect(history[0].score).to.equal(5000n);
        });

        it("should add volunteer to leaderboard on first event", async () => {
            await ledger.connect(vault).updateReputation(volunteer.address, 1000, EVENT_HASH_1);
            const len = await ledger.getLeaderboardLength();
            expect(len).to.equal(1n);
        });

        it("should not add volunteer to leaderboard twice", async () => {
            await ledger.connect(vault).updateReputation(volunteer.address, 1000, EVENT_HASH_1);
            await ledger.connect(vault).updateReputation(volunteer.address, 1000, EVENT_HASH_2);
            const len = await ledger.getLeaderboardLength();
            expect(len).to.equal(1n);
        });

        it("should emit ReputationUpdated event", async () => {
            await expect(
                ledger.connect(vault).updateReputation(volunteer.address, 5000, EVENT_HASH_1)
            )
                .to.emit(ledger, "ReputationUpdated")
                .withArgs(volunteer.address, 5000n, 5000n, 1n, anyValue);
        });

        it("should revert if called by non-VAULT_ROLE", async () => {
            await expect(
                ledger.connect(stranger).updateReputation(volunteer.address, 5000, EVENT_HASH_1)
            ).to.be.reverted;
        });

        it("should revert if volunteer is banned", async () => {
            await ledger.connect(admin).banAddress(volunteer.address);
            await expect(
                ledger.connect(vault).updateReputation(volunteer.address, 1000, EVENT_HASH_1)
            ).to.be.revertedWith("ReputationLedger: volunteer is banned");
        });
    });

    // ── Badge Awards ───────────────────────────────────────────────────────────

    describe("Badge awards", () => {
        async function doEvents(count, score = 3000) {
            for (let i = 0; i < count; i++) {
                const eh = ethers.id(`event-badge-${i}`);
                await ledger.connect(vault).updateReputation(volunteer.address, score, eh);
            }
        }

        it("BADGE_FIRST_STEP (id=1) awarded on event 1", async () => {
            await doEvents(1);
            expect(await ledger.hasBadge(volunteer.address, 1)).to.be.true;
        });

        it("BADGE_HELPER (id=2) awarded on event 5", async () => {
            await doEvents(5);
            expect(await ledger.hasBadge(volunteer.address, 2)).to.be.true;
        });

        it("BADGE_DEDICATED (id=3) awarded on event 10", async () => {
            await doEvents(10);
            expect(await ledger.hasBadge(volunteer.address, 3)).to.be.true;
        });

        it("BADGE_CHAMPION (id=4) awarded on event 25", async () => {
            await doEvents(25);
            expect(await ledger.hasBadge(volunteer.address, 4)).to.be.true;
        });

        it("BADGE_LEGEND (id=5) awarded on event 50", async () => {
            await doEvents(50);
            expect(await ledger.hasBadge(volunteer.address, 5)).to.be.true;
        });

        it("BADGE_HIGH_IMPACT (id=6) awarded for single event score >= 8000", async () => {
            await ledger.connect(vault).updateReputation(volunteer.address, 8000, EVENT_HASH_1);
            expect(await ledger.hasBadge(volunteer.address, 6)).to.be.true;
        });

        it("BADGE_PERFECT (id=7) awarded for single event score >= 10000", async () => {
            await ledger.connect(vault).updateReputation(volunteer.address, 10000, EVENT_HASH_1);
            expect(await ledger.hasBadge(volunteer.address, 7)).to.be.true;
        });

        it("BADGE_CENTURY (id=8) awarded for cumulative >= 1,000,000", async () => {
            // 50 events × 25,000 = 1,250,000 cumulative
            await doEvents(50, 25000);
            expect(await ledger.hasBadge(volunteer.address, 8)).to.be.true;
        });

        it("BADGE_TITAN (id=9) awarded for cumulative >= 5,000,000", async () => {
            // 50 events × 110,000 = 5,500,000 cumulative
            await doEvents(50, 110000);
            expect(await ledger.hasBadge(volunteer.address, 9)).to.be.true;
        });

        it("getBadges() returns correct list", async () => {
            await doEvents(1, 10000); // FIRST_STEP + PERFECT
            const badges = await ledger.getBadges(volunteer.address);
            expect(badges.map(b => Number(b))).to.include.members([1, 7]);
        });

        it("getAllBadges() returns 9 entries", async () => {
            const all = await ledger.getAllBadges(volunteer.address);
            expect(all.length).to.equal(9);
        });

        it("should emit BadgeEarned event", async () => {
            await expect(
                ledger.connect(vault).updateReputation(volunteer.address, 3000, EVENT_HASH_1)
            ).to.emit(ledger, "BadgeEarned").withArgs(
                volunteer.address, 1n, "First Step", anyValue
            );
        });
    });

    // ── Governance — updateRanks ───────────────────────────────────────────────

    describe("updateRanks()", () => {
        it("KEEPER_ROLE can push ranks", async () => {
            await ledger.connect(vault).updateReputation(volunteer.address, 5000, EVENT_HASH_1);
            await ledger.connect(keeper).updateRanks([volunteer.address], [1]);
            const [, , , rank] = await ledger.getReputation(volunteer.address);
            expect(rank).to.equal(1n);
        });

        it("should emit RanksUpdated", async () => {
            await ledger.connect(vault).updateReputation(volunteer.address, 5000, EVENT_HASH_1);
            await expect(
                ledger.connect(keeper).updateRanks([volunteer.address], [1])
            ).to.emit(ledger, "RanksUpdated").withArgs(1n, anyValue);
        });

        it("should revert on array length mismatch", async () => {
            await expect(
                ledger.connect(keeper).updateRanks([volunteer.address], [1, 2])
            ).to.be.revertedWith("Array length mismatch");
        });

        it("non-KEEPER cannot call updateRanks", async () => {
            await expect(
                ledger.connect(stranger).updateRanks([volunteer.address], [1])
            ).to.be.reverted;
        });
    });

    // ── Leaderboard Pagination ─────────────────────────────────────────────────

    describe("getLeaderboardPage()", () => {
        beforeEach(async () => {
            await ledger.connect(vault).updateReputation(volunteer.address, 5000, EVENT_HASH_1);
            await ledger.connect(vault).updateReputation(volunteer2.address, 3000, EVENT_HASH_2);
        });

        it("returns first page correctly", async () => {
            const [addrs, scores] = await ledger.getLeaderboardPage(0, 10);
            expect(addrs.length).to.equal(2);
            expect(addrs[0]).to.equal(volunteer.address);
            expect(scores[0]).to.equal(5000n);
        });

        it("respects limit", async () => {
            const [addrs] = await ledger.getLeaderboardPage(0, 1);
            expect(addrs.length).to.equal(1);
        });

        it("respects offset", async () => {
            const [addrs] = await ledger.getLeaderboardPage(1, 10);
            expect(addrs.length).to.equal(1);
            expect(addrs[0]).to.equal(volunteer2.address);
        });
    });

    // ── Moderation — banAddress / unbanAddress ────────────────────────────────

    describe("banAddress() / unbanAddress()", () => {
        it("admin can ban an address", async () => {
            await ledger.connect(admin).banAddress(volunteer.address);
            expect(await ledger.isBanned(volunteer.address)).to.be.true;
        });

        it("should emit AddressBanned", async () => {
            await expect(
                ledger.connect(admin).banAddress(volunteer.address)
            ).to.emit(ledger, "AddressBanned").withArgs(volunteer.address, anyValue);
        });

        it("non-admin cannot ban", async () => {
            await expect(
                ledger.connect(stranger).banAddress(volunteer.address)
            ).to.be.reverted;
        });

        it("cannot ban twice", async () => {
            await ledger.connect(admin).banAddress(volunteer.address);
            await expect(
                ledger.connect(admin).banAddress(volunteer.address)
            ).to.be.revertedWith("Already banned");
        });

        it("admin can unban", async () => {
            await ledger.connect(admin).banAddress(volunteer.address);
            await ledger.connect(admin).unbanAddress(volunteer.address);
            expect(await ledger.isBanned(volunteer.address)).to.be.false;
        });

        it("banned address is hidden from leaderboard", async () => {
            await ledger.connect(vault).updateReputation(volunteer.address, 5000, EVENT_HASH_1);
            await ledger.connect(vault).updateReputation(volunteer2.address, 3000, EVENT_HASH_2);

            await ledger.connect(admin).banAddress(volunteer.address);

            const [addrs] = await ledger.getLeaderboardPage(0, 10);
            expect(addrs.map(a => a.toLowerCase())).to.not.include(volunteer.address.toLowerCase());
            expect(addrs.length).to.equal(1);
        });
    });

    // ── Global Stats ───────────────────────────────────────────────────────────

    describe("getGlobalStats()", () => {
        it("tracks participants and total impact score", async () => {
            await ledger.connect(vault).updateReputation(volunteer.address, 4000, EVENT_HASH_1);
            await ledger.connect(vault).updateReputation(volunteer2.address, 3000, EVENT_HASH_2);
            const [participants, totalScore] = await ledger.getGlobalStats();
            expect(participants).to.equal(2n);
            expect(totalScore).to.equal(7000n);
        });
    });
});
