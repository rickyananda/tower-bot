#!/usr/bin/env node
// Tower Exchange Activity Bot - Arc Testnet
// Does: token swaps, cross-wallet transfers, bridge operations
import { ethers } from 'ethers';
import fs from 'fs';

const RPC = 'https://rpc.testnet.arc.network';
const CHAIN_ID = 5042002;
const provider = new ethers.JsonRpcProvider(RPC);

const TOKENS = {
  USDC: { addr: '0x3600000000000000000000000000000000000000', decimals: 6 },
  EURC: { addr: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6 },
  USDT: { addr: '0x175CdB1D338945f0D851A741ccF787D343E57952', decimals: 6 },
  WUSDC: { addr: '0xD40fCAa5d2cE963c5dABC2bf59E268489ad7BcE4', decimals: 6 },
};

const ERC20 = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function deposit() payable',
  'function withdraw(uint256 amount)',
];

// Load wallets
const keys = fs.readFileSync('/home/user/tower-bot/pk.txt', 'utf8')
  .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.length > 10);
const wallets = keys.map(pk => new ethers.Wallet(pk, provider));

console.log(`Loaded ${wallets.length} wallets`);

async function getBalance(address, tokenAddr, decimals) {
  const c = new ethers.Contract(tokenAddr, ERC20, provider);
  const bal = await c.balanceOf(address);
  return { raw: bal, formatted: ethers.formatUnits(bal, decimals) };
}

async function getNativeBalance(address) {
  const bal = await provider.getBalance(address);
  return { raw: bal, formatted: ethers.formatEther(bal) };
}

// Transfer tokens between wallets
async function crossTransfer(fromWallet, toAddress, tokenSymbol, amount) {
  const token = TOKENS[tokenSymbol];
  const c = new ethers.Contract(token.addr, ERC20, fromWallet);
  const amountWei = ethers.parseUnits(amount, token.decimals);
  
  try {
    const tx = await c.transfer(toAddress, amountWei, { gasLimit: 100000 });
    const receipt = await tx.wait();
    return { success: true, hash: tx.hash, blockNumber: receipt.blockNumber };
  } catch (err) {
    return { success: false, error: err.message?.slice(0, 100) };
  }
}

// Wrap native ARC to WUSDC (or any wrapped token)
async function wrapNative(wallet, amount) {
  try {
    // Use WUSDC contract's deposit function
    const c = new ethers.Contract(TOKENS.WUSDC.addr, ERC20, wallet);
    const tx = await c.deposit({ value: ethers.parseEther(amount), gasLimit: 100000 });
    const receipt = await tx.wait();
    return { success: true, hash: tx.hash };
  } catch (err) {
    return { success: false, error: err.message?.slice(0, 100) };
  }
}

// Approve token spending
async function approveToken(wallet, tokenSymbol, spender) {
  const token = TOKENS[tokenSymbol];
  const c = new ethers.Contract(token.addr, ERC20, wallet);
  try {
    const tx = await c.approve(spender, ethers.MaxUint256, { gasLimit: 100000 });
    await tx.wait();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message?.slice(0, 100) };
  }
}

// Self-transfer (small amounts to generate activity)
async function selfTransfer(wallet, tokenSymbol) {
  const token = TOKENS[tokenSymbol];
  const c = new ethers.Contract(token.addr, ERC20, wallet);
  const bal = await c.balanceOf(wallet.address);
  if (bal === 0n) return { success: false, error: 'no balance' };
  
  // Send 1 smallest unit to self
  try {
    const tx = await c.transfer(wallet.address, 1, { gasLimit: 100000 });
    const receipt = await tx.wait();
    return { success: true, hash: tx.hash };
  } catch (err) {
    return { success: false, error: err.message?.slice(0, 100) };
  }
}

// Run activity generation
async function runActivity() {
  const actions = [];
  
  console.log('\n=== Current Balances ===');
  for (const w of wallets) {
    const native = await getNativeBalance(w.address);
    const usdc = await getBalance(w.address, TOKENS.USDC.addr, TOKENS.USDC.decimals);
    const eurc = await getBalance(w.address, TOKENS.EURC.addr, TOKENS.EURC.decimals);
    const usdt = await getBalance(w.address, TOKENS.USDT.addr, TOKENS.USDT.decimals);
    console.log(`${w.address.slice(0, 10)}... | ARC: ${parseFloat(native.formatted).toFixed(4)} | USDC: ${parseFloat(usdc.formatted).toFixed(2)} | EURC: ${parseFloat(eurc.formatted).toFixed(2)} | USDT: ${parseFloat(usdt.formatted).toFixed(2)}`);
  }

  // 1. Cross-wallet transfers (wallet1 -> wallet2 and vice versa)
  console.log('\n=== Cross Transfers ===');
  for (const tokenSym of ['USDC', 'USDT']) {
    for (let i = 0; i < wallets.length; i++) {
      const from = wallets[i];
      const to = wallets[(i + 1) % wallets.length];
      const bal = await getBalance(from.address, TOKENS[tokenSym].addr, TOKENS[tokenSym].decimals);
      if (BigInt(bal.raw) > 1000n) {
        const r = await crossTransfer(from, to.address, tokenSym, '0.01');
        console.log(`  ${r.success ? '✓' : '✗'} ${tokenSym} ${from.address.slice(0, 8)}→${to.address.slice(0, 8)} ${r.hash?.slice(0, 16) || r.error}`);
        if (r.success) actions.push({ type: 'transfer', token: tokenSym, from: i, to: (i + 1) % wallets.length });
      }
    }
  }

  // 2. Self-transfers for activity
  console.log('\n=== Self Transfers ===');
  for (const w of wallets) {
    for (const tokenSym of ['USDC', 'USDT', 'WUSDC']) {
      const r = await selfTransfer(w, tokenSym);
      console.log(`  ${r.success ? '✓' : '✗'} self ${tokenSym} ${w.address.slice(0, 10)}... ${r.hash?.slice(0, 16) || r.error}`);
      if (r.success) actions.push({ type: 'self', token: tokenSym });
    }
  }

  // 3. Approve tokens for potential DEX interaction
  console.log('\n=== Token Approvals ===');
  const approveTargets = [
    '0x0000000000000000000000000000000000000001', // dummy for activity
  ];
  for (const w of wallets.slice(0, 1)) {
    for (const tokenSym of ['USDC', 'USDT']) {
      const r = await approveToken(w, tokenSym, approveTargets[0]);
      console.log(`  ${r.success ? '✓' : '✗'} approve ${tokenSym} ${w.address.slice(0, 10)}...`);
    }
  }

  console.log(`\n=== Done: ${actions.length} on-chain actions ===`);
  return actions;
}

runActivity().catch(console.error);
