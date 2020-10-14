const { BN } = require('@openzeppelin/test-helpers');
const { promisify } = require('util');
const { time } = require('@openzeppelin/test-helpers');
const { web3 } = require('@openzeppelin/test-environment');
const { expect } = require('chai');

const NBT_DECIMALS = 18;

function $NBT (x, tax = 0) {
  var dec = new BN(0)
  if(x % 1 != 0)
    dec = (new BN((x % 1) * 1000)).mul((new BN(10)).pow(new BN(NBT_DECIMALS - 3)))
  if(tax == 0)
    return (new BN(x)).mul((new BN(10)).pow(new BN(NBT_DECIMALS))).add(dec)

  var fee = (new BN(tax)).mul((new BN(10)).pow(new BN(NBT_DECIMALS))).div(new BN(100))
  return (new BN(x)).mul((new BN(10)).pow(new BN(NBT_DECIMALS))).add(dec).sub(fee)
}

function checkNBTAprox (x, y, tax = 0) {
  checkAprox(x, $NBT(y, tax), Math.pow(10, 15));
}

function checkSharesAprox (x, y) {
  checkAprox(x, y, 10 ** 12);
}

function checkAprox (x, y, delta_) {
  const delta = new BN(parseInt(delta_));
  const upper = y.add(delta);
  const lower = y.sub(delta);
  expect(x).to.be.bignumber.at.least(lower).and.bignumber.at.most(upper);
}

class TimeController {
  async initialize () {
    this.currentTime = await time.latest();
  }
  async advanceTime (seconds) {
    this.currentTime = this.currentTime.add(new BN(seconds));
    await setTimeForNextTransaction(this.currentTime);
  }
  async executeEmptyBlock () {
    await time.advanceBlock();
  }
  async executeAsBlock (Transactions) {
    await this.pauseTime();
    Transactions();
    await this.resumeTime();
    await time.advanceBlock();
  }
  async pauseTime () {
    return promisify(web3.currentProvider.send.bind(web3.currentProvider))({
      jsonrpc: '2.0',
      method: 'miner_stop',
      id: new Date().getTime()
    });
  }
  async resumeTime () {
    return promisify(web3.currentProvider.send.bind(web3.currentProvider))({
      jsonrpc: '2.0',
      method: 'miner_start',
      id: new Date().getTime()
    });
  }
}

async function printMethodOutput (r) {
  console.log(r.logs);
}

async function printStatus (dist) {
  console.log('Total Locked: ', await dist.totalLocked.call().toString());
  console.log('Total UnLocked: ', await dist.totalUnlocked.call().toString());
  const c = (await dist.unlockScheduleCount.call()).toNumber();
  console.log(await dist.unlockScheduleCount.call().toString());

  for (let i = 0; i < c; i++) {
    console.log(await dist.unlockSchedules.call(i).toString());
  }
  // TODO: Print the following variables:
  // await dist.totalLocked.call()
  // await dist.totalUnlocked.call()
  // await dist.unlockScheduleCount.call()
  // dist.updateAccounting.call() // and all the logs
  // dist.unlockSchedules.call(1)
}

async function increaseTimeForNextTransaction (diff) {
  await promisify(web3.currentProvider.send.bind(web3.currentProvider))({
    jsonrpc: '2.0',
    method: 'evm_increaseTime',
    params: [diff.toNumber()],
    id: new Date().getTime()
  });
}

async function setTimeForNextTransaction (target) {
  if (!BN.isBN(target)) {
    target = new BN(target);
  }

  const now = (await time.latest());

  if (target.lt(now)) throw Error(`Cannot increase current time (${now}) to a moment in the past (${target})`);
  const diff = target.sub(now);
  increaseTimeForNextTransaction(diff);
}

module.exports = {checkNBTAprox, checkSharesAprox, $NBT, setTimeForNextTransaction, TimeController, printMethodOutput, printStatus};
