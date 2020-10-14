const { contract, web3, accounts } = require('@openzeppelin/test-environment');
const { expectRevert, expectEvent, BN, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const _require = require('app-root-path').require;
const {
  $NBT
} = _require('/test/helper');

const MockERC20 = contract.fromArtifact('MockERC20');
const NBTERC20 = contract.fromArtifact('NBT');
const TokenGeyser = contract.fromArtifact('TokenGeyser');
const InitialSharesPerToken = 10 ** 6;

let nbt, dist, owner, anotherAccount;
describe('staking', function () {
  beforeEach('setup contracts', async function () {
    const [_owner, user1] =  accounts;

    owner = _owner;
    anotherAccount = user1;

    nbt = await NBTERC20.new();
    await nbt.initialize({from: owner});

    const startBonus = 50;
    const bonusPeriod = 86400;
    dist = await TokenGeyser.new(nbt.address, nbt.address, 10, startBonus, bonusPeriod,
      InitialSharesPerToken, {from: owner});
  });

  describe('when start bonus too high', function () {
    it('should fail to construct', async function () {
      await expectRevert(TokenGeyser.new(nbt.address, nbt.address, 10, 101, 86400, InitialSharesPerToken),
        'TokenGeyser: start bonus too high');
    });
  });

  describe('when bonus period is 0', function () {
    it('should fail to construct', async function () {
      await expectRevert(TokenGeyser.new(nbt.address, nbt.address, 10, 50, 0, InitialSharesPerToken),
        'TokenGeyser: bonus period is zero');
    });
  });

  describe('getStakingToken', function () {
    it('should return the staking token', async function () {
      expect(await dist.getStakingToken.call()).to.equal(nbt.address);
    });
  });

  describe('token', function () {
    it('should return the staking token', async function () {
      expect(await dist.token.call()).to.equal(nbt.address);
    });
  });

  describe('supportsHistory', function () {
    it('should return supportsHistory', async function () {
      expect(await dist.supportsHistory.call()).to.be.false;
    });
  });

  describe('stake', function () {
    describe('when the amount is 0', function () {
      it('should fail', async function () {
        await nbt.approve(dist.address, $NBT(1000), { from: owner });
        await expectRevert.unspecified(dist.stake($NBT(0), [], { from: owner }));
      });
    });

    describe('when token transfer has not been approved', function () {
      it('should fail', async function () {
        await nbt.approve(dist.address, $NBT(10), {from: owner});
        await expectRevert.unspecified(dist.stake($NBT(100), [], { from: owner }));
      });
    });

    describe('when totalStaked=0', function () {
      beforeEach(async function () {
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($NBT(0));
        await nbt.approve(dist.address, $NBT(100), {from: owner});
      });
      it('should updated the total staked', async function () {
        await dist.stake($NBT(100), [], { from: owner });
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($NBT(100));
        expect(await dist.totalStakedFor.call(owner)).to.be.bignumber.equal($NBT(100));
        expect(await dist.totalStakingShares.call()).to.be.bignumber.equal($NBT(100).mul(new BN(InitialSharesPerToken)));
      });
      it('should log Staked', async function () {
        const r = await dist.stake($NBT(100), [], { from: owner });
        expectEvent(r, 'Staked', {
          user: owner,
          amount: $NBT(100),
          total: $NBT(100)
        });
      });
    });

    describe('when totalStaked>0', function () {
      beforeEach(async function () {
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($NBT(0));
        await nbt.transfer(anotherAccount, $NBT(50), {from: owner});
        await nbt.approve(dist.address, $NBT(50), { from: anotherAccount });
        await dist.stake($NBT(50), [], { from: anotherAccount });
        await nbt.approve(dist.address, $NBT(150), { from: owner });
        await dist.stake($NBT(150), [], { from: owner });
      });
      it('should updated the total staked', async function () {
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($NBT(200));
        expect(await dist.totalStakedFor.call(anotherAccount)).to.be.bignumber.equal($NBT(50));
        expect(await dist.totalStakedFor.call(owner)).to.be.bignumber.equal($NBT(150));
        expect(await dist.totalStakingShares.call()).to.be.bignumber.equal($NBT(200).mul(new BN(InitialSharesPerToken)));
      });
    });
  });

  describe('stakeFor', function () {
    describe('when the beneficiary is ZERO_ADDRESS', function () {
      it('should fail', async function () {
        await expectRevert(dist.stakeFor(constants.ZERO_ADDRESS, $NBT(100), [], { from: owner }),
          'TokenGeyser: beneficiary is zero address');
      });
    });

    describe('when the beneficiary is a valid address', function () {
      beforeEach(async function () {
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($NBT(0));
        await nbt.approve(dist.address, $NBT(100), { from: owner });
      });
      it('should deduct nbts for the staker', async function () {
        const b = await nbt.balanceOf.call(owner);
        await dist.stakeFor(anotherAccount, $NBT(100), [], { from: owner });
        const b_ = await nbt.balanceOf.call(owner);
        expect(b.sub(b_)).to.be.bignumber.equal($NBT(100));
      });
      it('should updated the total staked on behalf of the beneficiary', async function () {
        await dist.stakeFor(anotherAccount, $NBT(100), [], { from: owner });
        expect(await dist.totalStaked.call()).to.be.bignumber.equal($NBT(100));
        expect(await dist.totalStakedFor.call(anotherAccount)).to.be.bignumber.equal($NBT(100));
        expect(await dist.totalStakedFor.call(owner)).to.be.bignumber.equal($NBT(0));
        expect(await dist.totalStakingShares.call()).to.be.bignumber.equal($NBT(100).mul(new BN(InitialSharesPerToken)));
      });
      it('should log Staked', async function () {
        const r = await dist.stakeFor(anotherAccount, $NBT(100), [], { from: owner });
        expectEvent(r, 'Staked', {
          user: anotherAccount,
          amount: $NBT(100),
          total: $NBT(100)
        });
      });
      it('only callable by owner', async function () {
        await nbt.transfer(anotherAccount, $NBT(10), { from: owner });
        await nbt.approve(dist.address, $NBT(10), { from: anotherAccount });
        // stakesFor only callable by owner
        await dist.stakeFor(owner, $NBT(1), [], { from: owner });
        await expectRevert(dist.stakeFor(owner, $NBT(1), [], { from: anotherAccount }),
            'Ownable: caller is not the owner.');
      });
    });
  });
});


describe('rescueFundsFromStakingPool', function () {
  describe('when tokens gets air-dropped', function() {
    it('should allow the owner to claim them', async function() {
      const [_owner, user1] =  accounts;

      owner = (_owner);
      anotherAccount = (user1);

      nbt = await NBTERC20.new();
      await nbt.initialize({ from: owner });

      const startBonus = 50;
      const bonusPeriod = 86400;
      const dist = await TokenGeyser.new(nbt.address, nbt.address, 10, startBonus, bonusPeriod,
        InitialSharesPerToken, { from: owner });

      await nbt.approve(dist.address, $NBT(100), { from: owner });
      await dist.stake($NBT(100), [], { from: owner });

      const transfers = await nbt.contract.getPastEvents('Transfer');
      const transferLog = transfers[transfers.length - 1];
      const stakingPool = transferLog.returnValues.to;

      expect(await nbt.balanceOf.call(stakingPool)).to.be.bignumber.equal($NBT(100));

      const token = await MockERC20.new(1000);
      await token.transfer(stakingPool, 1000);

      expect(await token.balanceOf.call(anotherAccount)).to.be.bignumber.equal('0');
      await dist.rescueFundsFromStakingPool(
        token.address, anotherAccount, 1000, { from: owner }
      );
      expect(await token.balanceOf.call(anotherAccount)).to.be.bignumber.equal('1000');

      await expectRevert(
        dist.rescueFundsFromStakingPool(nbt.address, anotherAccount, $NBT(10), { from: owner }),
        'TokenPool: Cannot claim token held by the contract'
      );

      expect(await nbt.balanceOf.call(stakingPool)).to.be.bignumber.equal($NBT(100));
    })
  });
});
