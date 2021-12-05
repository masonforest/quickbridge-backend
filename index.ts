import * as dotenv from "dotenv";
import * as express from "express";
import * as path from "path";
import * as qs from "qs";
import * as cors from "cors";
import {ethers} from "ethers";
import fetch from "node-fetch";

const {Wallet, utils, constants} = ethers;
const {parseEther, formatEther, parseUnits, hexlify, isAddress} = utils;
const {WeiPerEther} = constants;

dotenv.config();
const PROD = true;
const ETHEREUM_CHAIN_ID = PROD ? "0x01" : "0x04";
const POLYGON_CHAIN_ID = PROD ? "0x89" : "0x013881";
const TRANSFER_TIMEOUT = 1000 * 5;
const DEFAULT_PORT = 8080;
const {PORT, PRIVATE_KEY} = process.env;
const ETH_WEB3_URL = PROD
  ? "https://api.mycryptoapi.com/eth"
  : "https://rinkeby-light.eth.linkpool.io";
const POLYGON_WEB3_URL = PROD
  ? "https://polygon-rpc.com/"
  : "https://rpc-mumbai.maticvigil.com/";
const ETH_PROVIDER = new ethers.providers.JsonRpcProvider(ETH_WEB3_URL);
const POLYGON_PROVIDER = new ethers.providers.JsonRpcProvider(POLYGON_WEB3_URL);
const ETH_WALLET = new Wallet(PRIVATE_KEY, ETH_PROVIDER);
const POLYGON_WALLET = new Wallet(PRIVATE_KEY, POLYGON_PROVIDER);

console.log(`Starting bridge at: ${ETH_WALLET.address}`);
const app = express();
let ethToAddress = null;
let MATICToAddress = null;

ETH_PROVIDER.on("block", async (blockNumber) => {
  (await ETH_PROVIDER.getBlockWithTransactions(blockNumber)).transactions
    .filter(({to}) => to === ETH_WALLET.address)
    .forEach(async ({value: EthValue, to, from}) => {
      const price = await getPrice("MATIC", "ETH", EthValue);
      const value = (EthValue.toBigInt() * price) / WeiPerEther.toBigInt();
      const txHash = await sendMATIC(ethToAddress || from, value);
      console.log(`Sent ${formatEther(value)} MATIC to ${to} -> ${txHash}`);
    });
});

POLYGON_PROVIDER.on("block", async (blockNumber) => {
  console.log(blockNumber);
  (await POLYGON_PROVIDER.getBlockWithTransactions(blockNumber)).transactions
    .filter(({to}) => to === POLYGON_WALLET.address)
    .forEach(async ({value: MATICValue, to, from}) => {
      const price = await getPrice("ETH", "MATIC", MATICValue);
      const value = (MATICValue.toBigInt() * price) / WeiPerEther.toBigInt();
      const txHash = await sendETH(MATICToAddress || from, value);
      console.log(`Sent ${formatEther(value)} ETH to ${to} -> ${txHash}`);
    });
});

async function getETHGasPrice() {
  const response = await fetch("https://blocknative-api.herokuapp.com/data");
  const json = await response.json();
  return {
    maxPriorityFeePerGas: parseUnits(json.estimatedPrices[0].maxPriorityFeePerGas.toString(), "gwei").toBigInt(),
    maxFeePerGas: parseUnits(json.estimatedPrices[0].maxFeePerGas.toString(), "gwei").toBigInt(),
  }
    
}
// getETHGasPrice().then(console.log)

async function getGasPrice(priority) {
  const response = await fetch("https://gasstation-mainnet.matic.network/");
  const json = await response.json();
  return parseUnits(json[priority].toString(), "gwei").toBigInt();
}

const sendMATIC = async (to, value) => {
  const tx = await POLYGON_WALLET.sendTransaction({
    chainId: await POLYGON_WALLET.getChainId(),
    gasPrice: await getGasPrice("standard"),
    to,
    value,
  });
  return (await tx.wait()).transactionHash;
};

const sendETH = async (to, value) => {
  let txAttrs = {
    chainId: await ETH_WALLET.getChainId(),
    gasLimit: 21000,
    to,
    value,
  }

  if (PROD) {
    txAttrs = {
      ...txAttrs,
      ...await getETHGasPrice()
    }
  }
  const tx = await ETH_WALLET.sendTransaction(txAttrs);
  return (await tx.wait()).transactionHash;
};

const getPrice = async (buyToken, sellToken, sellAmount) => {
  const URL = "https://api.0x.org/swap/v1/price?";
  const params = {
    buyToken,
    sellToken,
    sellAmount: sellAmount.toString(),
  };
  const response = await fetch(`${URL}${qs.stringify(params)}`);
  const json = await response.json();
  return parseEther(json.price).toBigInt();
};
getPrice("ETH", "MATIC", (1 * Math.pow(10, 18)).toString());

app.use(express.json());
app.use(cors());

app.post("/", (req, res) => {
  let {destinationAddress, destinationChainId} = req.body;
  if (isAddress(destinationAddress)) {
    console.log(destinationChainId);
    if (destinationChainId === ETHEREUM_CHAIN_ID) {
      if (ethToAddress === null) {
        ethToAddress = destinationAddress;
        res.status(201).end();
        setTimeout(() => {
          ethToAddress = null;
        }, TRANSFER_TIMEOUT);
      } else {
        res.status(409).end();
      }
    } else if (destinationChainId === POLYGON_CHAIN_ID) {
      if (MATICToAddress === null) {
        MATICToAddress = destinationAddress;
        setTimeout(() => {
          MATICToAddress = null;
        }, TRANSFER_TIMEOUT);
        res.status(201).end();
      } else {
        res.status(409).end();
      }
    } else {
      res.status(400).end();
    }
  } else {
    res.status(400).end();
  }
});

// start the express server
app.listen(PORT || DEFAULT_PORT, () => {
  console.log(`server started at http://localhost:${PORT || DEFAULT_PORT}`);
});
