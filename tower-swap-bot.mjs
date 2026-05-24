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
};

const DEXES = ['synthra', 'unitflow', 'xylonet-adapter'];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

async function getBalances(address) {
  const bal = {};
  for (const [sym, t] of Object.entries(TOKENS)) {
    const c = new ethers.Contract(t.addr, ERC20_ABI, provider);
    bal[sym] = ethers.formatUnits(await c.balanceOf(address), t.decimals);
  }
  bal.ARC = ethers.formatEther(await provider.getBalance(address));
  return bal;
}

async function doSwap(wallet, fromToken, toToken, amountHuman, dexId) {
  const token = TOKENS[fromToken];
  const amount = ethers.parseUnits(amountHuman, token.decimals);
  
  console.log(`\n🔄 ${wallet.address.slice(0,10)}... ${amountHuman} ${fromToken} → ${toToken} [${dexId}]`);
  
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
    body: JSON.stringify({
      quote: quote.data,
      userAddress: wallet.address
    })
  });
  const built = await buildResp.json();
  if (!built.success) {
    console.log(`  ✗ Build failed`);
    return false;
  }
  
  const { approval, swap } = built.data;
  
  // 3. Send approval txs
  for (const a of (approval || [])) {
    try {
      console.log(`  📝 Approving...`);
      const tx = await wallet.sendTransaction({
        to: a.to,
        data: a.data,
        value: BigInt(a.value || '0x0'),
        gasLimit: BigInt(a.gasLimit || '0x186a0')
      });
      await tx.wait();
      console.log(`  ✓ Approved ${tx.hash.slice(0,16)}...`);
    } catch (e) {
      console.log(`  ⚠ Approval: ${e.message?.slice(0,80)}`);
    }
  }
  
  // 4. Send swap tx
  try {
    const outAmt = swap.expectedUserOutput || swap.platformFeeAmount || '?';
    console.log(`  🔄 Swapping...`);
    const tx = await wallet.sendTransaction({
      to: swap.to,
      data: swap.data,
      value: BigInt(swap.value || '0x0'),
      gasLimit: BigInt(swap.gasLimit || '0x7a120')
    });
    console.log(`  TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  ✓ Block ${receipt.blockNumber} | Gas: ${receipt.gasUsed}`);
    return true;
  } catch (e) {
    console.log(`  ✗ Swap failed: ${e.message?.slice(0,120)}`);
    return false;
  }
}

async function main() {
  const count = parseInt(process.argv[2]) || 25;
  
  console.log(`\n═══ Tower Exchange Swap Bot ═══`);
  console.log(`Target: ${count} swaps | Wallets: ${wallets.length}`);
  
  let success = 0;
  let fail = 0;
  
  for (let i = 0; i < count; i++) {
    for (const wallet of wallets) {
      const bal = await getBalances(wallet.address);
      console.log(`\n--- #${i+1}/${count} | ${wallet.address.slice(0,10)}... ---`);
      console.log(`  USDC: ${parseFloat(bal.USDC).toFixed(4)} | EURC: ${parseFloat(bal.EURC).toFixed(4)} | ARC: ${parseFloat(bal.ARC).toFixed(4)}`);
      
      // Decide what to swap based on balance
      const dex = DEXES[i % DEXES.length];
      
      if (parseFloat(bal.USDC) > 0.15) {
        const ok = await doSwap(wallet, 'USDC', 'EURC', '0.1', dex);
        ok ? success++ : fail++;
        await new Promise(r => setTimeout(r, 2000));
      } else if (parseFloat(bal.EURC) > 0.1) {
        const ok = await doSwap(wallet, 'EURC', 'USDC', '0.05', dex);
        ok ? success++ : fail++;
        await new Promise(r => setTimeout(r, 2000));
      } else {
        console.log(`  ⏭ Low balance, skipping`);
      }
      
      if (success >= count) break;
    }
    if (success >= count) break;
  }
  
  // Final balances
  console.log(`\n═══ Final Balances ═══`);
  for (const w of wallets) {
    const bal = await getBalances(w.address);
    console.log(`${w.address.slice(0,10)}... USDC: ${parseFloat(bal.USDC).toFixed(4)} | EURC: ${parseFloat(bal.EURC).toFixed(4)} | ARC: ${parseFloat(bal.ARC).toFixed(4)}`);
  }
  console.log(`\n✅ Done: ${success} success / ${fail} failed`);
}

main().catch(console.error);
