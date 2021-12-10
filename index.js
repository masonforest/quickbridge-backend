import {default as StellarSdk, Keypair} from "stellar-sdk";
import dotenv from "dotenv";
import qs from "qs";
import fs from "fs";
import {ethers} from "ethers";
import fetch from "node-fetch";

const {Contract, Wallet, utils, constants} = ethers;
const {
  arrayify,
  parseEther,
  formatEther,
  parseUnits,
  hexlify,
  isAddress,
  getAddress,
} = utils;
const ONE_ETH = constants.WeiPerEther.toBigInt();
const ONE_XLM = 10n ** 7n;
dotenv.config();
const PROD = true;
const ETHEREUM_CHAIN_ID = PROD ? "0x01" : "0x04";
const POLYGON_CHAIN_ID = PROD ? "0x89" : "0x013881";
const QUICK_BRIDGE_POLYGON_ADDRESS = PROD
  ? "0x067ea7c93f95988aaa36805d33acf4d4dbd1dfc0"
  : "0x97a173f9e948a143aa78afc8d6b18bd87ab821ac";
const TRANSFER_TIMEOUT = 1000 * 5;
const DEFAULT_PORT = 8080;
const {PORT, PRIVATE_KEY, STELLAR_PRIVATE_KEY} = process.env;
const POLYGON_WEB3_URL = PROD
  ? "https://polygon-rpc.com/"
  : "https://rpc-mumbai.maticvigil.com/";
const STELLAR_SERVER_URL = PROD
  ? "https://horizon.stellar.org"
  : "https://horizon-testnet.stellar.org";
const POLYGON_PROVIDER = new ethers.providers.JsonRpcProvider(POLYGON_WEB3_URL);
const POLYGON_WALLET = new Wallet(PRIVATE_KEY, POLYGON_PROVIDER);
const WXLM = "0xf854225caaef5a722884a68a23215dfa5386751e";
const quickBridgeABI = JSON.parse(
  fs.readFileSync("QuickBridge.abi").toString()
);
const QUICK_BRIDGE = new Contract(
  QUICK_BRIDGE_POLYGON_ADDRESS,
  quickBridgeABI,
  POLYGON_PROVIDER
);

const STELLAR_SERVER = new StellarSdk.Server(STELLAR_SERVER_URL);

let ethToAddress = null;
let MATICToAddress = null;

const STELLAR_KEYPAIR = Keypair.fromSecret(STELLAR_PRIVATE_KEY);
console.log(STELLAR_KEYPAIR.publicKey());
async function onStellarPayment(payment) {
  const {records} = await payment.operations();
  let maticAddress;
  try {
    maticAddress = getAddress(
      "0x" + Buffer.from(payment.memo, "base64").toString("hex")
    );
  } catch {
    return;
  }

  for (let operation of records) {
    if (operation.type === "payment" && operation.transaction_successful) {
      const xlmAmount =
        (BigInt(operation.amount.replace(".", "")) * ONE_ETH) / ONE_XLM;
      const price = await getPrice("MATIC", WXLM, xlmAmount);
      const value = (price * xlmAmount) / ONE_ETH;
      const txHash = await sendMATIC(maticAddress, value);
      console.log(
        `Sent ${formatEther(value)} MATIC to ${maticAddress} -> ${txHash}`
      );
    }
  }
}

(async () => {
  let pagingToken = (
    await STELLAR_SERVER.transactions()
      .forAccount(STELLAR_KEYPAIR.publicKey())
      .limit(1)
      .order("desc")
      .call()
  ).records[0].paging_token;
  STELLAR_SERVER.transactions()
    .forAccount(STELLAR_KEYPAIR.publicKey())
    .cursor(pagingToken)
    .stream({
      onmessage: onStellarPayment,
    });
})();
QUICK_BRIDGE.on("Send", async (rawStellarAddress, maticValue) => {
  if (maticValue.toBigInt() === 0n) return null;
  const stellarAddress = new Keypair({
    type: "ed25519",
    publicKey: Buffer.from(arrayify(rawStellarAddress)),
  });
  const xlmPrice =
    ((await getPrice(WXLM, "MATIC", maticValue)) * ONE_XLM) / ONE_ETH;
  const xlmValue = (xlmPrice * maticValue.toBigInt()) / ONE_ETH;
  const txHash = await sendXLM(stellarAddress.publicKey(), xlmValue);
});

async function getETHGasPrice() {
  const response = await fetch("https://blocknative-api.herokuapp.com/data");
  const json = await response.json();
  return {
    maxPriorityFeePerGas: parseUnits(
      json.estimatedPrices[0].maxPriorityFeePerGas.toString(),
      "gwei"
    ).toBigInt(),
    maxFeePerGas: parseUnits(
      json.estimatedPrices[0].maxFeePerGas.toString(),
      "gwei"
    ).toBigInt(),
  };
}

const getPrice = async (buyToken, sellToken, sellAmount) => {
  const URL = "https://polygon.api.0x.org/swap/v1/price?";
  const params = {
    buyToken,
    sellToken,
    sellAmount: sellAmount.toString(),
  };
  const response = await fetch(`${URL}${qs.stringify(params)}`);
  const json = await response.json();
  return parseEther(json.price).toBigInt();
};

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

const sendXLM = async (destination, rawAmount) => {
  STELLAR_SERVER;
  const account = await STELLAR_SERVER.loadAccount(STELLAR_KEYPAIR.publicKey());
  const fee = await STELLAR_SERVER.fetchBaseFee();
  const amount = (Number(rawAmount) / Number(ONE_XLM)).toFixed(7).toString();
  const transaction = new StellarSdk.TransactionBuilder(account, {fee})
    .addOperation(
      StellarSdk.Operation.payment({
        destination,
        asset: StellarSdk.Asset.native(),
        amount,
      })
    )
    .setTimeout(StellarSdk.TimeoutInfinite)
    .setNetworkPassphrase(PROD ? "Public Global Stellar Network ; September 2015":"Test SDF Network ; September 2015")
    .build();
  transaction.sign(STELLAR_KEYPAIR);
  const transactionResult = await STELLAR_SERVER.submitTransaction(transaction);
  console.log(`Sent ${amount} XLM to ${destination}:`);
  console.log(transactionResult._links.transaction.href);
};
