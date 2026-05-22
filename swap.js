import { ethers } from 'ethers';
import fs from 'fs';
import chalk from 'chalk';

// ═══════════════════════════════════════════════════════════════
// TOWER EXCHANGE - SWAP MODULE
// Handles actual swap execution on Arc Testnet
// ═══════════════════════════════════════════════════════════════

const ARC_TESTNET = {
  chainId: 5042002,
  rpc: 'https://rpc.testnet.arc.network'
};

// Standard Uniswap V2 Router address on most chains
// This needs to be verified for Arc Testnet
const ROUTER_ADDRESS = '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582'; // Uniswap Universal Router

// Token addresses (need to be updated for Arc Testnet)
const TOKENS = {
  USDC: { address: '0x0000000000000000000000000000000000000000', decimals: 6 },
  EURC: { address: '0x0000000000000000000000000000000000000000', decimals: 6 },
  USDT: { address: '0x0000000000000000000000000000000000000000', decimals: 6 }
};

// Uniswap V2 Router ABI
const ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function WETH() external pure returns (address)'
];

// ERC20 ABI
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

export class SwapExecutor {
  constructor(privateKey) {
    this.provider = new ethers.JsonRpcProvider(ARC_TESTNET.rpc);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, this.wallet);
  }

  // Get token balance
  async getTokenBalance(tokenAddress) {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    const balance = await contract.balanceOf(this.wallet.address);
    const decimals = await contract.decimals();
    return { balance, decimals, formatted: ethers.formatUnits(balance, decimals) };
  }

  // Get quote for swap
  async getQuote(fromToken, toToken, amount) {
    try {
      const from = TOKENS[fromToken];
      const to = TOKENS[toToken];
      
      const amountIn = ethers.parseUnits(amount, from.decimals);
      const path = [from.address, to.address];
      
      const amounts = await this.router.getAmountsOut(amountIn, path);
      const amountOut = amounts[amounts.length - 1];
      
      return {
        amountIn: amount,
        amountOut: ethers.formatUnits(amountOut, to.decimals),
        path
      };
    } catch (error) {
      console.log(chalk.red(`Quote error: ${error.message}`));
      return null;
    }
  }

  // Approve token spend
  async approve(tokenAddress, amount) {
    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
      const tx = await contract.approve(ROUTER_ADDRESS, amount);
      console.log(chalk.white(`  Approval tx: ${tx.hash}`));
      await tx.wait();
      console.log(chalk.green(`  ✓ Approved`));
      return true;
    } catch (error) {
      console.log(chalk.red(`  ✗ Approval failed: ${error.message}`));
      return false;
    }
  }

  // Execute swap
  async swap(fromToken, toToken, amount) {
    try {
      const from = TOKENS[fromToken];
      const to = TOKENS[toToken];
      
      const amountIn = ethers.parseUnits(amount, from.decimals);
      const path = [from.address, to.address];
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
      
      // Get quote first
      const quote = await this.getQuote(fromToken, toToken, amount);
      if (!quote) return false;
      
      console.log(chalk.white(`  Quote: ${amount} ${fromToken} → ${quote.amountOut} ${toToken}`));
      
      // Check allowance
      const contract = new ethers.Contract(from.address, ERC20_ABI, this.wallet);
      const allowance = await contract.allowance(this.wallet.address, ROUTER_ADDRESS);
      
      if (allowance < amountIn) {
        console.log(chalk.white(`  Approving ${fromToken}...`));
        const approved = await this.approve(from.address, amountIn);
        if (!approved) return false;
      }
      
      // Execute swap
      console.log(chalk.white(`  Executing swap...`));
      const tx = await this.router.swapExactTokensForTokens(
        amountIn,
        0, // Accept any amount out (use quote in production)
        path,
        this.wallet.address,
        deadline
      );
      
      console.log(chalk.white(`  TX: ${tx.hash}`));
      const receipt = await tx.wait();
      console.log(chalk.green(`  ✓ Swap confirmed in block ${receipt.blockNumber}`));
      
      return true;
    } catch (error) {
      console.log(chalk.red(`  ✗ Swap failed: ${error.message}`));
      return false;
    }
  }
}

// Export for use in main bot
export default SwapExecutor;
