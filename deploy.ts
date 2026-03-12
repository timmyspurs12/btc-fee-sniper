import { getContract, JSONRpcProvider } from "@btc-vision/op-wallet-connect";
import * as fs from "fs";
import * as path from "path";

/**
 * deploy.ts — Deploy FeeSniper to OPNet testnet or mainnet
 *
 * Usage:
 *   npx ts-node deploy.ts --network testnet --privatekey <WIF>
 *   npx ts-node deploy.ts --network mainnet --privatekey <WIF>
 */

const args = process.argv.slice(2);
const getArg = (flag: string, fallback = "") => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const NETWORK = getArg("--network", "testnet");
const PRIVATE_KEY = getArg("--privatekey", "");

const RPC_ENDPOINTS: Record<string, string> = {
    testnet: "https://testnet.opnet.org",
    mainnet: "https://api.opnet.org",
};

async function deploy() {
    if (!PRIVATE_KEY) {
        console.error("❌  --privatekey <WIF> is required");
        process.exit(1);
    }

    const rpcUrl = RPC_ENDPOINTS[NETWORK];
    if (!rpcUrl) {
        console.error(`❌  Unknown network: ${NETWORK}`);
        process.exit(1);
    }

    console.log(`\n⚡ Deploying FeeSniper to OPNet ${NETWORK}...`);
    console.log(`   RPC: ${rpcUrl}\n`);

    // Load compiled WASM
    const wasmPath = path.join(__dirname, "build", "FeeSniper.wasm");
    if (!fs.existsSync(wasmPath)) {
        console.error(`❌  WASM not found at ${wasmPath}`);
        console.error(
            "   Run: npm run build   (compiles AssemblyScript → WASM)"
        );
        process.exit(1);
    }

    const wasmBytes = fs.readFileSync(wasmPath);
    console.log(`   WASM size: ${wasmBytes.byteLength} bytes`);

    const provider = new JSONRpcProvider(rpcUrl);

    try {
        // Deploy contract
        const deployTx = await provider.deployContract({
            bytecode: wasmBytes,
            privateKey: PRIVATE_KEY,
        });

        console.log(`\n✅  Contract deployed!`);
        console.log(`   TXID     : ${deployTx.txid}`);
        console.log(`   Address  : ${deployTx.contractAddress}`);
        console.log(
            `   Explorer : https://${NETWORK === "mainnet" ? "" : "testnet."}opnet.org/contract/${deployTx.contractAddress}`
        );

        // Save address to file for frontend
        const config = {
            network: NETWORK,
            contractAddress: deployTx.contractAddress,
            deployedAt: new Date().toISOString(),
            txid: deployTx.txid,
        };
        fs.writeFileSync(
            path.join(__dirname, "frontend", "src", "contract-config.json"),
            JSON.stringify(config, null, 2)
        );
        console.log(`\n   Config saved to frontend/src/contract-config.json`);
        console.log(`\n   Next: cd frontend && npm install && npm run dev\n`);
    } catch (err: any) {
        console.error(`\n❌  Deployment failed: ${err.message}`);
        process.exit(1);
    }
}

deploy();
