# 🏗️ Tower Exchange Auto Swap Bot

Automated trading bot for [Tower Exchange](https://www.tower.exchange) on **Arc Testnet**.

## 📋 Overview

- **Chain**: Arc Testnet (Chain ID: 5042002)
- **RPC**: https://rpc.testnet.arc.network
- **Explorer**: https://explorer.testnet.arc.network
- **Tokens**: USDC, EURC, USDT (stablecoins)

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd tower-bot
npm install
```

### 2. Configure Wallets
Create `pk.txt` with your private keys (one per line):
```
your_private_key_1
your_private_key_2
```

⚠️ **NEVER share your private keys or commit them to git!**

### 3. Get Testnet Tokens

#### Get Sepolia ETH (for gas):
- [Alchemy Faucet](https://www.alchemy.com/faucets/ethereum-sepolia)
- [Chainlink Faucet](https://faucets.chain.link)
- [QuickNode Faucet](https://faucet.quicknode.com/ethereum/sepolia)

#### Get USDC/EURC:
- [Circle Faucet](https://faucet.circle.com)

#### Bridge to Arc Testnet:
- Use Tower Exchange bridge: https://www.tower.exchange

### 4. Run the Bot
```bash
node index.js
```

## 📁 Project Structure

```
tower-bot/
├── index.js          # Main bot with auto-swap
├── swap.js           # Swap execution module
├── faucet.js         # Faucet claiming module
├── pk.txt            # Private keys (create this)
├── pk.txt.example    # Example private keys file
├── package.json      # Dependencies
└── README.md         # This file
```

## ⚙️ Configuration

### Auto-Swap Settings (in index.js)
```javascript
await this.startAutoSwap({
  interval: 60000,      // 1 minute between cycles
  pairs: [
    ['USDC', 'EURC'],
    ['USDC', 'USDT'],
    ['EURC', 'USDT']
  ],
  minAmount: 1,         // Minimum swap amount
  maxAmount: 5          // Maximum swap amount
});
```

## 🔧 Features

- ✅ Multi-wallet support
- ✅ Auto-swap between stablecoins
- ✅ Balance monitoring
- ✅ Statistics tracking
- ✅ Faucet integration info
- ✅ Graceful shutdown (Ctrl+C)

## 📊 Supported Tokens

| Token | Decimals | Status |
|-------|----------|--------|
| USDC  | 6        | ⚠️ Need address on Arc |
| EURC  | 6        | ⚠️ Need address on Arc |
| USDT  | 6        | ⚠️ Need address on Arc |

## ⚠️ Important Notes

1. **Token Addresses**: The bot currently needs actual token addresses on Arc Testnet. Check the [explorer](https://explorer.testnet.arc.network) for verified contracts.

2. **Router Contract**: The swap uses Uniswap V2 router interface. Verify the router address on Arc Testnet.

3. **Gas Fees**: You need ARC tokens for gas. Get them from the faucet or bridge.

4. **Invite Code**: Tower Exchange is invite-only. You need an invite code to access the platform.

## 🔗 Links

- [Tower Exchange](https://www.tower.exchange)
- [Tower Docs](https://tower-exchange.gitbook.io/tower)
- [Arc Testnet Explorer](https://explorer.testnet.arc.network)
- [Circle Faucet](https://faucet.circle.com)

## 📝 License

ISC

## ⚠️ Disclaimer

This bot is for educational purposes on testnet only. Use at your own risk. Never use real funds or share private keys.
