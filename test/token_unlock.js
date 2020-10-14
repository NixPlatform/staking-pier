const { contract, web3, accounts } = require('@openzeppelin/test-environment');
const { expectRevert, BN, time, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const _require = require('app-root-path').require;
const {
  $NBT,
  checkNBTAprox,
  checkSharesAprox,
  setTimeForNextTransaction,
  TimeController
} = _require('/test/helper');

const NBTERC20 = contract.fromArtifact('NBT');
const TokenGeyser = contract.fromArtifact('TokenGeyser');

const ONE_YEAR = 365 * 24 * 3600;
const START_BONUS = 50;
const BONUS_PERIOD = 86400;
const InitialSharesPerToken = 10 ** 6;

let nbt, dist, owner, anotherAccount;
async function setupContractAndAccounts () {
  const [_owner, user1] =  accounts;

  owner = _owner;
  anotherAccount = user1;

  nbt = await NBTERC20.new();
  await nbt.initialize({from: owner});

  dist = await TokenGeyser.new(nbt.address, nbt.address, 10, START_BONUS, BONUS_PERIOD,
    InitialSharesPerToken, {from: owner});
}

async function checkAvailableToUnlock (dist, v) {
  const u = await dist.totalUnlocked.call();
  const r = await dist.updateAccounting.call();
  // console.log('Total unlocked: ', u.toString(), 'total unlocked after: ', r[1].toString());
  checkNBTAprox(r[1].sub(u), v);
}

describe('LockedPool', function () {
  beforeEach('setup contracts', async function () {
    await setupContractAndAccounts();
  });

  describe('getDistributionToken', function () {
    it('should return the staking token', async function () {
      expect(await dist.getDistributionToken.call()).to.equal(nbt.address);
    });
  });

  describe('lockTokens', function () {
    describe('when not approved', function () {
      it('should fail', async function () {
        const d = await TokenGeyser.new(nbt.address, nbt.address, 5, START_BONUS, BONUS_PERIOD, InitialSharesPerToken, {from: owner});
        await expectRevert.unspecified(d.lockTokens($NBT(10), ONE_YEAR, {from: owner}));
      });
    });

    describe('when number of unlock schedules exceeds the maxUnlockSchedules', function () {
      it('should fail', async function () {
        const d = await TokenGeyser.new(nbt.address, nbt.address, 5, START_BONUS, BONUS_PERIOD, InitialSharesPerToken, {from: owner});
        await nbt.approve(d.address, $NBT(100), {from: owner});
        await d.lockTokens($NBT(10), ONE_YEAR, {from: owner});
        await d.lockTokens($NBT(10), ONE_YEAR, {from: owner});
        await d.lockTokens($NBT(10), ONE_YEAR, {from: owner});
        await d.lockTokens($NBT(10), ONE_YEAR, {from: owner});
        await d.lockTokens($NBT(10), ONE_YEAR, {from: owner});
        await expectRevert(d.lockTokens($NBT(10), ONE_YEAR, {from: owner}),
          'TokenGeyser: reached maximum unlock schedules');
      });
    });

    describe('when totalLocked=0', function () {
      beforeEach(async function () {
        checkNBTAprox(await dist.totalLocked.call(), 0);
        await nbt.approve(dist.address, $NBT(100), {from: owner});
      });
      it('should updated the locked pool balance', async function () {
        await dist.lockTokens($NBT(100), ONE_YEAR, {from: owner});
        checkNBTAprox(await dist.totalLocked.call(), 100);
      });
      it('should create a schedule', async function () {
        await dist.lockTokens($NBT(100), ONE_YEAR, {from: owner});
        const s = await dist.unlockSchedules.call(0);
        expect(s[0]).to.be.bignumber.equal($NBT(100).mul(new BN(InitialSharesPerToken)));
        expect(s[1]).to.be.bignumber.equal($NBT(0));
        expect(s[2].add(s[4])).to.be.bignumber.equal(s[3]);
        expect(s[4]).to.be.bignumber.equal(`${ONE_YEAR}`);
        expect(await dist.unlockScheduleCount.call()).to.be.bignumber.equal('1');
      });
      it('should log TokensLocked', async function () {
        const r = await dist.lockTokens($NBT(100), ONE_YEAR, { from: owner });
        const l = r.logs.filter(l => l.event === 'TokensLocked')[0];
        checkNBTAprox(l.args.amount, 100);
        checkNBTAprox(l.args.total, 100);
        expect(l.args.durationSec).to.be.bignumber.equal(`${ONE_YEAR}`);
      });
      it('should be protected', async function () {
        await nbt.approve(dist.address, $NBT(100), { from: owner });
        await expectRevert(dist.lockTokens($NBT(50), ONE_YEAR, { from: anotherAccount }),
          'Ownable: caller is not the owner');
        await dist.lockTokens($NBT(50), ONE_YEAR, { from: owner });
      });
    });

    describe('when totalLocked>0', function () {
      const timeController = new TimeController();
      beforeEach(async function () {
        await nbt.approve(dist.address, $NBT(150), { from: owner });
        await dist.lockTokens($NBT(100), ONE_YEAR, { from: owner });
        await timeController.initialize();
        checkNBTAprox(await dist.totalLocked.call(), 100);
      });
      it('should updated the locked and unlocked pool balance', async function () {
        await timeController.advanceTime(ONE_YEAR / 10);
        await dist.lockTokens($NBT(50), ONE_YEAR, { from: owner });
        checkNBTAprox(await dist.totalLocked.call(), 100 * 0.9 + 50);
      });
      it('should log TokensUnlocked and TokensLocked', async function () {
        await timeController.advanceTime(ONE_YEAR / 10);
        const r = await dist.lockTokens($NBT(50), ONE_YEAR, { from: owner });

        let l = r.logs.filter(l => l.event === 'TokensUnlocked')[0];
        checkNBTAprox(l.args.amount, 100 * 0.1);
        checkNBTAprox(l.args.total, 100 * 0.9);

        l = r.logs.filter(l => l.event === 'TokensLocked')[0];
        checkNBTAprox(l.args.amount, 50);
        checkNBTAprox(l.args.total, 100 * 0.9 + 50);
        expect(l.args.durationSec).to.be.bignumber.equal(`${ONE_YEAR}`);
      });
      it('should create a schedule', async function () {
        await timeController.advanceTime(ONE_YEAR / 10);
        await dist.lockTokens($NBT(50), ONE_YEAR, { from: owner });
        const s = await dist.unlockSchedules.call(1);
        // struct UnlockSchedule {
        // 0   uint256 initialLockedShares;
        // 1   uint256 unlockedShares;
        // 2   uint256 lastUnlockTimestampSec;
        // 3   uint256 endAtSec;
        // 4   uint256 durationSec;
        // }
        checkSharesAprox(s[0], $NBT(50).mul(new BN(InitialSharesPerToken)));
        checkSharesAprox(s[1], new BN(0));
        expect(s[2].add(s[4])).to.be.bignumber.equal(s[3]);
        expect(s[4]).to.be.bignumber.equal(`${ONE_YEAR}`);
        expect(await dist.unlockScheduleCount.call()).to.be.bignumber.equal('2');
      });
    });
  });

  describe('unlockTokens', function () {
    describe('single schedule', function () {
      describe('after waiting for 1/2 the duration', function () {
        const timeController = new TimeController();
        beforeEach(async function () {
          await nbt.approve(dist.address, $NBT(100), { from: owner });
          await dist.lockTokens($NBT(100), ONE_YEAR, { from: owner });
          await timeController.initialize();
          await timeController.advanceTime(ONE_YEAR / 2);
        });

        describe('when supply is unchanged', function () {
          it('should unlock 1/2 the tokens', async function () {
            await timeController.executeEmptyBlock();
            expect(await dist.totalLocked.call()).to.be.bignumber.equal($NBT(100));
            expect(await dist.totalUnlocked.call()).to.be.bignumber.equal($NBT(0));
            await checkAvailableToUnlock(dist, 50);
          });
          it('should transfer tokens to unlocked pool', async function () {
            await dist.updateAccounting();
            checkNBTAprox(await dist.totalLocked.call(), 50);
            checkNBTAprox(await dist.totalUnlocked.call(), 50);
            await checkAvailableToUnlock(dist, 0);
          });
          it('should log TokensUnlocked and update state', async function () {
            const r = await dist.updateAccounting();
            const l = r.logs.filter(l => l.event === 'TokensUnlocked')[0];
            checkNBTAprox(l.args.amount, 50);
            checkNBTAprox(l.args.total, 50);
            const s = await dist.unlockSchedules(0);
            expect(s[0]).to.be.bignumber.equal($NBT(100).mul(new BN(InitialSharesPerToken)));
            checkSharesAprox(s[1], $NBT(50).mul(new BN(InitialSharesPerToken)));
          });
        });
      });

      describe('after waiting > the duration', function () {
        beforeEach(async function () {
          await nbt.approve(dist.address, $NBT(100), { from: owner });
          await dist.lockTokens($NBT(100), ONE_YEAR, { from: owner });
          await time.increase(2 * ONE_YEAR);
        });
        it('should unlock all the tokens', async function () {
          await checkAvailableToUnlock(dist, 100);
        });
        it('should transfer tokens to unlocked pool', async function () {
          expect(await dist.totalLocked.call()).to.be.bignumber.equal($NBT(100));
          expect(await dist.totalUnlocked.call()).to.be.bignumber.equal($NBT(0));
          await dist.updateAccounting();
          expect(await dist.totalLocked.call()).to.be.bignumber.equal($NBT(0));
          checkNBTAprox(await dist.totalUnlocked.call(), 100);
          await checkAvailableToUnlock(dist, 0);
        });
        it('should log TokensUnlocked and update state', async function () {
          const r = await dist.updateAccounting();
          const l = r.logs.filter(l => l.event === 'TokensUnlocked')[0];
          checkNBTAprox(l.args.amount, 100);
          checkNBTAprox(l.args.total, 0);
          const s = await dist.unlockSchedules(0);
          expect(s[0]).to.be.bignumber.equal($NBT(100).mul(new BN(InitialSharesPerToken)));
          expect(s[1]).to.be.bignumber.equal($NBT(100).mul(new BN(InitialSharesPerToken)));
        });
      });

      describe('dust tokens due to division underflow', function () {
        beforeEach(async function () {
          await nbt.approve(dist.address, $NBT(100), { from: owner });
          await dist.lockTokens($NBT(1), 10 * ONE_YEAR, { from: owner });
        });
        it('should unlock all tokens', async function () {
          // 1 NBT locked for 10 years. Almost all time passes upto the last minute.
          // 0.999999809 NBTs are unlocked.
          // 1 minute passes, Now: all of the rest are unlocked: 191
          // before (#24): only 190 would have been unlocked and 0.000000001 NBT would be
          // locked.
          await time.increase(10 * ONE_YEAR - 60);
          const r1 = await dist.updateAccounting();
          const l1 = r1.logs.filter(l => l.event === 'TokensUnlocked')[0];
          await time.increase(65);
          const r2 = await dist.updateAccounting();
          const l2 = r2.logs.filter(l => l.event === 'TokensUnlocked')[0];
          expect(l1.args.amount.add(l2.args.amount)).to.be.bignumber.equal($NBT(1));
        });
      });
    });

    describe('multi schedule', function () {
      const timeController = new TimeController();
      beforeEach(async function () {
        await nbt.approve(dist.address, $NBT(200), { from: owner });
        await dist.lockTokens($NBT(100), ONE_YEAR, { from: owner });
        await timeController.initialize();
        await timeController.advanceTime(ONE_YEAR / 2);
        await dist.lockTokens($NBT(100), ONE_YEAR, { from: owner });
        await timeController.advanceTime(ONE_YEAR / 10);
      });
      it('should return the remaining unlock value', async function () {
        await time.advanceBlock();
        expect(await dist.totalLocked.call()).to.be.bignumber.equal($NBT(150));
        expect(await dist.totalUnlocked.call()).to.be.bignumber.equal($NBT(50));
        // 10 from each schedule for the period of ONE_YEAR / 10

        await checkAvailableToUnlock(dist, 20);
      });
      it('should transfer tokens to unlocked pool', async function () {
        await dist.updateAccounting();
        checkNBTAprox(await dist.totalLocked.call(), 130);
        checkNBTAprox(await dist.totalUnlocked.call(), 70);
        await checkAvailableToUnlock(dist, 0);
      });
      it('should log TokensUnlocked and update state', async function () {
        const r = await dist.updateAccounting();

        const l = r.logs.filter(l => l.event === 'TokensUnlocked')[0];
        checkNBTAprox(l.args.amount, 20);
        checkNBTAprox(l.args.total, 130);

        const s1 = await dist.unlockSchedules(0);
        checkSharesAprox(s1[0], $NBT(100).mul(new BN(InitialSharesPerToken)));
        checkSharesAprox(s1[1], $NBT(60).mul(new BN(InitialSharesPerToken)));
        const s2 = await dist.unlockSchedules(1);
        checkSharesAprox(s2[0], $NBT(100).mul(new BN(InitialSharesPerToken)));
        checkSharesAprox(s2[1], $NBT(10).mul(new BN(InitialSharesPerToken)));
      });
      it('should continue linear the unlock', async function () {
        await dist.updateAccounting();
        await timeController.advanceTime(ONE_YEAR / 5);
        await dist.updateAccounting();

        checkNBTAprox(await dist.totalLocked.call(), 90);
        checkNBTAprox(await dist.totalUnlocked.call(), 110);
        await checkAvailableToUnlock(dist, 0);
        await timeController.advanceTime(ONE_YEAR / 5);
        await dist.updateAccounting();

        checkNBTAprox(await dist.totalLocked.call(), 50);
        checkNBTAprox(await dist.totalUnlocked.call(), 150);
        await checkAvailableToUnlock(dist, 0);
      });
    });
  });

  describe('updateAccounting', function () {
    let _r, _t;
    beforeEach(async function () {
      _r = await dist.updateAccounting.call({ from: owner });
      _t = await time.latest();
      await nbt.approve(dist.address, $NBT(300), { from: owner });
      await dist.stake($NBT(100), [], {from: owner});
      await dist.lockTokens($NBT(100), ONE_YEAR, {from: owner});
      await time.increase(ONE_YEAR / 2);
      await dist.lockTokens($NBT(100), ONE_YEAR, {from: owner});
      await time.increase(ONE_YEAR / 10);
    });

    describe('when user history does exist', async function () {
      it('should return the system state', async function () {
        const r = await dist.updateAccounting.call({ from: owner });
        const t = await time.latest();
        checkNBTAprox(r[0], 130);
        checkNBTAprox(r[1], 70);
        const timeElapsed = t.sub(_t);
        expect(r[2].div($NBT(100).mul(new BN(InitialSharesPerToken)))).to.be
          .bignumber.above(timeElapsed.sub(new BN(5))).and
          .bignumber.below(timeElapsed.add(new BN(5)));
        expect(r[3].div($NBT(100).mul(new BN(InitialSharesPerToken)))).to.be
          .bignumber.above(timeElapsed.sub(new BN(5))).and
          .bignumber.below(timeElapsed.add(new BN(5)));
        checkNBTAprox(r[4], 70);
        checkNBTAprox(r[4], 70);
        const delta = new BN(r[5]).sub(new BN(_r[5]));
        expect(delta).to.be
          .bignumber.above(timeElapsed.sub(new BN(1))).and
          .bignumber.below(timeElapsed.add(new BN(1)));
      });
    });

    describe('when user history does not exist', async function () {
      it('should return the system state', async function () {
        const r = await dist.updateAccounting.call({ from: constants.ZERO_ADDRESS });
        const t = await time.latest();
        checkNBTAprox(r[0], 130);
        checkNBTAprox(r[1], 70);
        const timeElapsed = t.sub(_t);
        expect(r[2].div($NBT(100).mul(new BN(InitialSharesPerToken)))).to.be.bignumber.equal('0');
        expect(r[3].div($NBT(100).mul(new BN(InitialSharesPerToken)))).to.be
          .bignumber.above(timeElapsed.sub(new BN(5))).and
          .bignumber.below(timeElapsed.add(new BN(5)));
        checkNBTAprox(r[4], 0);
        const delta = new BN(r[5]).sub(new BN(_r[5]));
        expect(delta).to.be
          .bignumber.above(timeElapsed.sub(new BN(1))).and
          .bignumber.below(timeElapsed.add(new BN(1)));
      });
    });
  });
});
