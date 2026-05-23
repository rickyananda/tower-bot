import { ethers } from 'ethers';
import chalk from 'chalk';

// ═══════════════════════════════════════════════════════════════
// TOWER EXCHANGE - SWAP MODULE (FIXED)
// Arc Testnet | Chain ID: 5042002
// ═══════════════════════════════════════════════════════════════

const ARC_TESTNET = {
  chainId: 5042002,
  rpc: 'https://rpc.testnet.arc.network'
};

// Token addresses on Arc Testnet (verified from Tower Exchange frontend)
const TOKENS = {
  USDC: { address: '0x3600000000000000000000000000000000000000', decimals: 6, symbol: 'USDC' },
  EURC: { address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6, symbol: 'EURC' },
  USDT: { address: '0x175CdB1D338945f0D851A741ccF787D343E57952', decimals: 6, symbol: 'USDT' },
  WUSDC: { address: '0xD40fCAa5d2cE963c5dABC2bf59E268489ad7BcE4', decimals: 6, symbol: 'WUSDC' }
};

// Uniswap V2 Router ABI
const ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function WETH() external pure returns (address)',
  'function factory() external pure returns (address)'
];

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

export class SwapExecutor {
  constructor(privateKey, routerAddress = null) {
    this.provider = new ethers.JsonRpcProvider(ARC_TESTNET.rpc);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.routerAddress = routerAddress;
    if (routerAddress) {
      this.router = new ethers.Contract(routerAddress, ROUTER_ABI, this.wallet);
    }
  }

  // Get token balance
  async getTokenBalance(tokenSymbol) {
    const token = TOKENS[tokenSymbol];
    if (!token) throw new Error(`Unknown token: ${tokenSymbol}`);
    
    const contract = new ethers.Contract(token.address, ERC20_ABI, this.provider);
    const balance = await contract.balanceOf(this.wallet.address);
    return { balance, decimals: token.decimals, formatted: ethers.formatUnits(balance, token.decimals) };
  }

  // Get all balances
  async getAllBalances() {
    const balances = { ARC: ethers.formatEther(await this.provider.getBalance(this.wallet.address)) };
    
    for (const [sym, token] of Object.entries(TOKENS)) {
      try {
        const b = await this.getTokenBalance(sym);
        balances[sym] = b.formatted;
      } catch { balances[sym] = '0'; }
    }
    return balances;
  }

  // Approve token spend
  async approve(tokenSymbol, amount) {
    const token = TOKENS[tokenSymbol];
    if (!token) throw new Error(`Unknown token: ${tokenSymbol}`);
    if (!this.routerAddress) throw new Error('Router address not set');

    try {
      const contract = new ethers.Contract(token.address, ERC20_ABI, this.wallet);
      const amountWei = ethers.parseUnits(amount, token.decimals);
      
      console.log(chalk.white(`  Approving ${amount} ${tokenSymbol}...`));
      const tx = await contract.approve(this.routerAddress, amountWei);
      console.log(chalk.white(`  Approval TX: ${tx.hash}`));
      await tx.wait();
      console.log(chalk.green(`  ✓ Approved`));
      return true;
    } catch (error) {
      console.log(chalk.red(`  ✗ Approval failed: ${error.message}`));
      return false;
    }
  }

  // Check and approve if needed
  async ensureApproval(tokenSymbol, amount) {
    const token = TOKENS[tokenSymbol];
    if (!token || !this.routerAddress) return false;

    const contract = new ethers.Contract(token.address, ERC20_ABI, this.provider);
    const amountWei = ethers.parseUnits(amount, token.decimals);
    const allowance = await contract.allowance(this.wallet.address, this.routerAddress);

    if (allowance < amountWei) {
      return await this.approve(tokenSymbol, amount);
    }
    console.log(chalk.white(`  ${tokenSymbol} already approved`));
    return true;
  }

  // Execute swap via Uniswap V2 Router
  async swap(fromToken, toToken, amount) {
    if (!this.router) throw new Error('Router not initialized');

    try {
      const from = TOKENS[fromToken];
      const to = TOKENS[toToken];
      const amountIn = ethers.parseUnits(amount, from.decimals);
      const path = [from.address, to.address];
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 min

      console.log(chalk.cyan(`\n🔄 Swap: ${amount} ${fromToken} → ${toToken}`));
      console.log(chalk.white(`  Wallet: ${this.wallet.address}`));

      // Ensure approval
      const approved = await this.ensureApproval(fromToken, amount);
      if (!approved) return false;

      // Get quote
      try {
        const amounts = await this.router.getAmountsOut(amountIn, path);
        const amountOut = ethers.formatUnits(amounts[amounts.length - 1], to.decimals);
        console.log(chalk.white(`  Quote: ${amount} ${fromToken} → ${amountOut} ${toToken}`));
      } catch (e) {
        console.log(chalk.yellow(`  Quote failed (pool may not exist): ${e.message.slice(0, 80)}`));
      }

      // Execute swap
      console.log(chalk.white(`  Executing swap...`));
      const tx = await this.router.swapExactTokensForTokens(
        amountIn,
        0, // Accept any output (slippage = 100% for testnet)
        path,
        this.wallet.address,
        deadline
      );

      console.log(chalk.white(`  TX: ${tx.hash}`));
      const receipt = await tx.wait();
      console.log(chalk.green(`  ✓ Confirmed in block ${receipt.blockNumber}`));
      return true;

    } catch (error) {
      console.log(chalk.red(`  ✗ Swap failed: ${error.message.slice(0, 100)}`));
      return false;
    }
  }

  // Transfer tokens to another address
  async transfer(tokenSymbol, toAddress, amount) {
    try {
      const token = TOKENS[tokenSymbol];
      if (!token) throw new Error(`Unknown token: ${tokenSymbol}`);

      const contract = new ethers.Contract(token.address, ERC20_ABI, this.wallet);
      const amountWei = ethers.parseUnits(amount, token.decimals);

      console.log(chalk.white(`  Transferring ${amount} ${tokenSymbol} to ${toAddress.slice(0, 10)}...`));
      const tx = await contract.transfer(toAddress, amountWei);
      console.log(chalk.white(`  TX: ${tx.hash}`));
      await tx.wait();
      console.log(chalk.green(`  ✓ Done`));
      return true;
    } catch (e) {
      console.log(chalk.red(`  ✗ Transfer failed: ${e.message.slice(0, 80)}`));
      return false;
    }
  }
}

export { TOKENS, ERC20_ABI, ARC_TESTNET };
export default SwapExecutor;
