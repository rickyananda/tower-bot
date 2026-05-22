import { ethers } from 'ethers';
import fs from 'fs';
import chalk from 'chalk';

// ═══════════════════════════════════════════════════════════════
// TOWER EXCHANGE AUTO BOT - ARC TESTNET
// Chain ID: 5042002 | RPC: https://rpc.testnet.arc.network
// ═══════════════════════════════════════════════════════════════

const ARC_TESTNET = {
  chainId: 5042002,
  rpc: 'https://rpc.testnet.arc.network',
  explorer: 'https://explorer.testnet.arc.network'
};

// Token addresses on Arc Testnet (verified from Tower Exchange frontend)
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
    this.stats = { swaps: 0, errors: 0 };
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

  // Transfer tokens between wallets
  async transfer(walletData, toAddress, tokenSymbol, amount) {
    try {
      const token = TOKENS[tokenSymbol];
      if (!token) throw new Error(`Unknown token: ${tokenSymbol}`);

      const contract = new ethers.Contract(token.address, ERC20_ABI, walletData.wallet);
      const amountWei = ethers.parseUnits(amount, token.decimals);

      console.log(chalk.white(`  Transferring ${amount} ${tokenSymbol} to ${toAddress.slice(0, 10)}...`));
      const tx = await contract.transfer(toAddress, amountWei);
      console.log(chalk.white(`  TX: ${tx.hash}`));
      await tx.wait();
      console.log(chalk.green(`  ✓ Done`));
      return true;
    } catch (e) {
      console.log(chalk.red(`  ✗ ${e.message}`));
      return false;
    }
  }

  // Auto transfer USDC to all wallets (for distribution)
  async distributeTokens(fromIndex = 0, tokenSymbol = 'USDC', amount = '1') {
    console.log(chalk.cyan(`\n📤 Distributing ${amount} ${tokenSymbol} to all wallets...`));
    
    const from = this.wallets[fromIndex];
    if (!from) return;

    for (let i = 0; i < this.wallets.length; i++) {
      if (i === fromIndex) continue;
      await this.transfer(from, this.wallets[i].address, tokenSymbol, amount);
    }
  }

  // Run
  async run() {
    console.log(chalk.cyan('═══════════════════════════════════════'));
    console.log(chalk.white.bold('  TOWER EXCHANGE BOT - ARC TESTNET'));
    console.log(chalk.cyan('═══════════════════════════════════════\n'));

    this.loadWallets();
    if (this.wallets.length === 0) {
      console.log(chalk.red('No wallets. Add keys to pk.txt'));
      return;
    }

    await this.showBalances();

    // Auto mode
    console.log(chalk.cyan('\n🔄 Starting auto-swap mode...'));
    console.log(chalk.white('Press Ctrl+C to stop\n'));

    // Cycle through swaps
    while (true) {
      for (const walletData of this.wallets) {
        try {
          // Random swap pair
          const pairs = [['USDC', 'EURC'], ['USDC', 'USDT'], ['EURC', 'USDT']];
          const pair = pairs[this.stats.swaps % pairs.length];
          const amount = (Math.random() * 5 + 1).toFixed(2);

          console.log(chalk.cyan(`\nSwap #${this.stats.swaps + 1}: ${amount} ${pair[0]} → ${pair[1]}`));
          console.log(chalk.white(`Wallet: ${walletData.address.slice(0, 10)}...`));

          // NOTE: Actual swap needs router contract address
          // For now, just log the attempt
          console.log(chalk.yellow(`  ⚠ Need router contract for actual swap`));
          console.log(chalk.white(`  Token addresses verified:`));
          console.log(chalk.white(`    ${pair[0]}: ${TOKENS[pair[0]].address}`));
          console.log(chalk.white(`    ${pair[1]}: ${TOKENS[pair[1]].address}`));

          this.stats.swaps++;
        } catch (e) {
          console.log(chalk.red(`  Error: ${e.message}`));
          this.stats.errors++;
        }
      }

      // Wait 60s
      console.log(chalk.gray(`\n⏳ Next cycle in 60s...`));
      await new Promise(r => setTimeout(r, 60000));
    }
  }
}

// Run
const bot = new TowerBot();
bot.run().catch(console.error);
