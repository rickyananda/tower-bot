#!/usr/bin/env node
import { ethers } from 'ethers';
import fs from 'fs';

const RPC = 'https://rpc.testnet.arc.network';
const provider = new ethers.JsonRpcProvider(RPC);

const keys = fs.readFileSync('/home/user/tower-bot/pk.txt', 'utf8')
  .split('\n').map(l => l.trim()).filter(l => l && l.length > 10);
const wallets = keys.map(pk => new ethers.Wallet(pk, provider));

const TOKENS = {
  USDC: { addr: '0x3600000000000000000000000000000000000000', decimals: 6 },
  EURC: { addr: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6 },
  USDT: { addr: '0x175CdB1D338945f0D851A741ccF787D343E57952', decimals: 6 },
  WUSDC: { addr: '0xD40fCAa5d2cE963c5dABC2bf59E268489ad7BcE4', decimals: 18 },
  USYC: { addr: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C', decimals: 6 },
};

const DEXES = ['synthra', 'unitflow', 'xylonet-adapter'];

// Swap pairs: swap + bridge combos
const SWAP_PAIRS = [
  { from: 'USDC', to: 'EURC', dex: 'synthra', amount: '0.1', type: 'swap' },
  { from: 'EURC', to: 'USDC', dex: 'unitflow', amount: '0.05', type: 'swap' },
  { from: 'USDC', to: 'EURC', dex: 'xylonet-adapter', amount: '0.08', type: 'bridge' },
  { from: 'USDC', to: 'WUSDC', dex: 'xylonet-adapter', amount: '0.05', type: 'bridge' },
  { from: 'USDC', to: 'USYC', dex: 'xylonet-adapter', amount: '0.03', type: 'bridge' },
  { from: 'EURC', to: 'USDC', dex: 'synthra', amount: '0.05', type: 'swap' },
  { from: 'USDC', to: 'EURC', dex: 'unitflow', amount: '0.1', type: 'swap' },
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

async function getBalances(address) {
  const bal = {};
  for (const [sym, t] of Object.entries(TOKENS)) {
    try {
      const c = new ethers.Contract(t.addr, ERC20_ABI, provider);
      bal[sym] = parseFloat(ethers.formatUnits(await c.balanceOf(address), t.decimals));
    } catch { bal[sym] = 0; }
  }
  bal.ARC = parseFloat(ethers.formatEther(await provider.getBalance(address)));
  return bal;
}

async function doSwap(wallet, fromToken, toToken, amountHuman, dexId, type) {
  const token = TOKENS[fromToken];
  const amount = ethers.parseUnits(amountHuman, token.decimals);
  
  const label = type === 'bridge' ? '🌉' : '🔄';
  console.log(`\n${label} ${wallet.address.slice(0,10)}... ${amountHuman} ${fromToken} → ${toToken} [${dexId}]`);
  
  // 1. Get quote
  const quoteResp = await fetch('https://www.tower.exchange/api/swap/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputToken: token.addr,
      outputToken: TOKENS[toToken].addr,
      inputAmount: amount.toString(),
      slippageTolerance: '0.5',
      dexId
    })
  });
  const quote = await quoteResp.json();
  if (!quote.success) {
    console.log(`  ✗ Quote failed`);
    return false;
  }
  
  // 2. Build tx
  const buildResp = await fetch('https://www.tower.exchange/api/swap/build-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quote: quote.data, userAddress: wallet.address })
  });
  const built = await buildResp.json();
  if (!built.success) {
    console.log(`  ✗ Build failed`);
    return false;
  }
  
  const { approval, swap } = built.data;
  
  // 3. Send approval txs (skip if already approved — errors are fine)
  for (const a of (approval || [])) {
    try {
      const tx = await wallet.sendTransaction({
        to: a.to,
        data: a.data,
        value: BigInt(a.value || '0x0'),
        gasLimit: BigInt(a.gasLimit || '0x186a0')
      });
      await tx.wait();
    } catch (e) {
      // Already approved or gas issue — continue
    }
  }
  
  // 4. Send swap/bridge tx
  try {
    const tx = await wallet.sendTransaction({
      to: swap.to,
      data: swap.data,
      value: BigInt(swap.value || '0x0'),
      gasLimit: BigInt(swap.gasLimit || '0x7a120')
    });
    console.log(`  TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  ✓ Block ${receipt.blockNumber}`);
    return true;
  } catch (e) {
    console.log(`  ✗ Failed: ${e.message?.slice(0,100)}`);
    return false;
  }
}

async function main() {
  const count = parseInt(process.argv[2]) || 50;
  
  console.log(`\n═══ Tower Exchange Swap + Bridge Bot ═══`);
  console.log(`Target: ${count} txs | Wallets: ${wallets.length} | Pairs: ${SWAP_PAIRS.length}`);
  
  let success = 0;
  let fail = 0;
  const txHashes = [];
  
  for (let i = 0; i < count; i++) {
    for (const wallet of wallets) {
      if (success >= count) break;
      
      const bal = await getBalances(wallet.address);
      const pair = SWAP_PAIRS[i % SWAP_PAIRS.length];
      
      console.log(`\n--- #${success+1}/${count} | ${wallet.address.slice(0,10)}... ---`);
      console.log(`  USDC: ${bal.USDC.toFixed(4)} | EURC: ${bal.EURC.toFixed(4)} | WUSDC: ${bal.WUSDC.toFixed(4)} | USYC: ${bal.USYC.toFixed(4)}`);
      
      // Check if we have enough balance for this pair
      if (bal[pair.from] < parseFloat(pair.amount) + 0.01) {
        console.log(`  ⏭ Low ${pair.from}, trying reverse...`);
        // Try reverse pair
        const reversePair = SWAP_PAIRS.find(p => p.from !== pair.from && bal[p.from] >= parseFloat(p.amount) + 0.01);
        if (reversePair) {
          const ok = await doSwap(wallet, reversePair.from, reversePair.to, reversePair.amount, reversePair.dex, reversePair.type);
          ok ? success++ : fail++;
        } else {
          console.log(`  ⏭ No balance for any pair, skipping`);
        }
      } else {
        const ok = await doSwap(wallet, pair.from, pair.to, pair.amount, pair.dex, pair.type);
        ok ? success++ : fail++;
      }
      
      await new Promise(r => setTimeout(r, 2000));
    }
    if (success >= count) break;
  }
  
  // Final balances
  console.log(`\n═══ Final Balances ═══`);
  for (const w of wallets) {
    const bal = await getBalances(w.address);
    console.log(`${w.address.slice(0,10)}... USDC: ${bal.USDC.toFixed(4)} | EURC: ${bal.EURC.toFixed(4)} | WUSDC: ${bal.WUSDC.toFixed(4)} | USYC: ${bal.USYC.toFixed(4)} | ARC: ${bal.ARC.toFixed(4)}`);
  }
  console.log(`\n✅ Done: ${success} success / ${fail} failed`);
}

main().catch(console.error);
