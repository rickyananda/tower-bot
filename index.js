import { ethers } from 'ethers';
import fs from 'fs';
import chalk from 'chalk';

// ═══════════════════════════════════════════════════════════════
// TOWER EXCHANGE AUTO BOT - ARC TESTNET (FIXED)
// Chain ID: 5042002 | RPC: https://rpc.testnet.arc.network
// 
// Strategy: Generate on-chain activity via token transfers
// (Swap requires Tower's custom backend API - not publicly available)
// ═══════════════════════════════════════════════════════════════

const ARC_TESTNET = {
  chainId: 5042002,
  rpc: 'https://rpc.testnet.arc.network',
  explorer: 'https://explorer.testnet.arc.network'
};

// Verified token addresses on Arc Testnet
const TOKENS = {
  USDC: { address: '0x3600000000000000000000000000000000000000', decimals: 6, symbol: 'USDC' },
  EURC: { address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6, symbol: 'EURC' },
  USDT: { address: '0x175CdB1D338945f0D851A741ccF787D343E57952', decimals: 6, symbol: 'USDT' },
  WUSDC: { address: '0xD40fCAa5d2cE963c5dABC2bf59E268489ad7BcE4', decimals: 6, symbol: 'WUSDC' }
};

// ERC20 ABI
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)'
];

class TowerBot {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(ARC_TESTNET.rpc);
    this.wallets = [];
    this.stats = { transfers: 0, errors: 0, startTime: Date.now() };
  }

  // Load wallets from pk.txt
  loadWallets() {
    try {
      const content = fs.readFileSync('pk.txt', 'utf8');
      const keys = content.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#') && l.length > 10);

      for (const key of keys) {
        try {
          const wallet = new ethers.Wallet(key, this.provider);
          this.wallets.push({ wallet, address: wallet.address, pk: key });
          console.log(chalk.green(`✓ ${wallet.address}`));
        } catch (e) {
          console.log(chalk.red(`✗ Invalid: ${key.slice(0, 10)}...`));
        }
      }
      console.log(chalk.cyan(`\nTotal: ${this.wallets.length} wallets`));
    } catch (e) {
      console.log(chalk.red(`Error: ${e.message}`));
    }
  }

  // Get all balances
  async getBalances(address) {
    const balances = { ARC: ethers.formatEther(await this.provider.getBalance(address)) };
    for (const [sym, token] of Object.entries(TOKENS)) {
      try {
        const c = new ethers.Contract(token.address, ERC20_ABI, this.provider);
        const bal = await c.balanceOf(address);
        balances[sym] = ethers.formatUnits(bal, token.decimals);
      } catch { balances[sym] = '0'; }
    }
    return balances;
  }

  // Display balances
  async showBalances() {
    console.log(chalk.cyan('\n💰 BALANCES'));
    console.log(chalk.gray('─'.repeat(50)));
    for (const { address } of this.wallets) {
      const b = await this.getBalances(address);
      console.log(chalk.white(`\n${address}`));
      console.log(chalk.white(`  ARC:  ${parseFloat(b.ARC).toFixed(4)}`));
      console.log(chalk.white(`  USDC: ${parseFloat(b.USDC).toFixed(2)}`));
      console.log(chalk.white(`  EURC: ${parseFloat(b.EURC).toFixed(2)}`));
      console.log(chalk.white(`  USDT: ${parseFloat(b.USDT).toFixed(2)}`));
      console.log(chalk.white(`  WUSDC: ${parseFloat(b.WUSDC).toFixed(2)}`));
    }
  }

  // Transfer tokens
  async transfer(walletData, toAddress, tokenSymbol, amount) {
    try {
      const token = TOKENS[tokenSymbol];
      if (!token) throw new Error(`Unknown token: ${tokenSymbol}`);

      const contract = new ethers.Contract(token.address, ERC20_ABI, walletData.wallet);
      const amountWei = ethers.parseUnits(amount, token.decimals);

      console.log(chalk.white(`  ${amount} ${tokenSymbol} → ${toAddress.slice(0, 10)}...`));
      const tx = await contract.transfer(toAddress, amountWei);
      console.log(chalk.white(`  TX: ${tx.hash}`));
      await tx.wait();
      console.log(chalk.green(`  ✓ Confirmed`));
      this.stats.transfers++;
      return true;
    } catch (e) {
      console.log(chalk.red(`  ✗ ${e.message.slice(0, 80)}`));
      this.stats.errors++;
      return false;
    }
  }

  // Send ARC (native token)
  async sendARC(walletData, toAddress, amount) {
    try {
      console.log(chalk.white(`  ${amount} ARC → ${toAddress.slice(0, 10)}...`));
      const tx = await walletData.wallet.sendTransaction({
        to: toAddress,
        value: ethers.parseEther(amount)
      });
      console.log(chalk.white(`  TX: ${tx.hash}`));
      await tx.wait();
      console.log(chalk.green(`  ✓ Confirmed`));
      this.stats.transfers++;
      return true;
    } catch (e) {
      console.log(chalk.red(`  ✗ ${e.message.slice(0, 80)}`));
      this.stats.errors++;
      return false;
    }
  }

  // Self-transfer (send to self to generate activity)
  async selfTransfer(walletData, tokenSymbol, amount) {
    console.log(chalk.cyan(`  Self-transfer: ${amount} ${tokenSymbol}`));
    return await this.transfer(walletData, walletData.address, tokenSymbol, amount);
  }

  // Display stats
  showStats() {
    const elapsed = Math.floor((Date.now() - this.stats.startTime) / 1000);
    console.log(chalk.cyan('\n📊 STATS'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(chalk.white(`  Transfers: ${this.stats.transfers}`));
    console.log(chalk.white(`  Errors: ${this.stats.errors}`));
    console.log(chalk.white(`  Runtime: ${elapsed}s`));
  }

  // Auto mode - generate on-chain activity
  async run() {
    console.log(chalk.cyan('═══════════════════════════════════════'));
    console.log(chalk.white.bold('  TOWER EXCHANGE BOT - ARC TESTNET'));
    console.log(chalk.white('  On-chain activity generator'));
    console.log(chalk.cyan('═══════════════════════════════════════\n'));

    this.loadWallets();
    if (this.wallets.length === 0) {
      console.log(chalk.red('No wallets. Add keys to pk.txt'));
      return;
    }

    await this.showBalances();

    console.log(chalk.cyan('\n🔄 Starting activity generation...'));
    console.log(chalk.white('Press Ctrl+C to stop\n'));

    let cycle = 0;
    const tokens = ['USDC', 'EURC', 'USDT'];

    while (true) {
      cycle++;
      console.log(chalk.cyan(`\n═══ Cycle #${cycle} ═══`));

      for (const walletData of this.wallets) {
        try {
          // Get current balances
          const balances = await this.getBalances(walletData.address);

          // Self-transfer USDC (generates on-chain activity)
          if (parseFloat(balances.USDC) > 0.01) {
            const amount = (Math.random() * 2 + 0.01).toFixed(2);
            await this.selfTransfer(walletData, 'USDC', amount);
            await new Promise(r => setTimeout(r, 3000));
          }

          // Self-transfer ARC
          if (parseFloat(balances.ARC) > 0.01) {
            const amount = (Math.random() * 0.5 + 0.001).toFixed(4);
            await this.sendARC(walletData, walletData.address, amount);
            await new Promise(r => setTimeout(r, 3000));
          }

        } catch (e) {
          console.log(chalk.red(`Error: ${e.message}`));
          this.stats.errors++;
        }
      }

      this.showStats();

      // Wait 60s between cycles
      console.log(chalk.gray(`\n⏳ Next cycle in 60s...`));
      await new Promise(r => setTimeout(r, 60000));
    }
  }
}

// Run
const bot = new TowerBot();
process.on('SIGINT', () => { bot.showStats(); process.exit(0); });
bot.run().catch(console.error);
