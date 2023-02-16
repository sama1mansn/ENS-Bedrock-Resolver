import { BigNumber, Contract, ethers } from "ethers";
import {
    makeStateTrieProof,
    makeMerkleTreeProof,
    asL2Provider,
    L2Provider,
    CrossChainMessenger,
    StateRootBatchHeader,
    StateRoot,
} from "@eth-optimism/sdk";
import { toRpcHexString } from "@eth-optimism/core-utils";
import { StorageHelper } from "../storage/StorageService";
import { keccak256 } from "ethers/lib/utils";

const TEXTS_SLOT_NAME = 9;
const ZERO_BYTES = "0x0000000000000000000000000000000000000000000000000000000000000000";

interface StorageProof {
    key: string;
    value: string;
    proof: string[];
    storageTrieWitness: string;
}

interface ProofInputObject {
    target: string;
    stateRoot: string;
    stateRootBatchHeader: StateRootBatchHeader;
    stateRootProof: {
        index: number;
        siblings: string[];
    };
    stateTrieWitness: string;
    storageProofs: StorageProof[];
}
export class ProofService {
    private readonly l1_provider: ethers.providers.StaticJsonRpcProvider;
    private readonly l2_provider: L2Provider<ethers.providers.StaticJsonRpcProvider>;
    private readonly crossChainMessenger: CrossChainMessenger;

    constructor(l1_provider: ethers.providers.StaticJsonRpcProvider, l2_provider: ethers.providers.JsonRpcProvider) {
        this.l1_provider = l1_provider;
        this.l2_provider = asL2Provider(l2_provider);
        this.crossChainMessenger = new CrossChainMessenger({
            l1ChainId: 1,
            l2ChainId: 10,
            l1SignerOrProvider: this.l1_provider,
            l2SignerOrProvider: this.l2_provider,
        });
    }

    public async proofText(resolverAddr: string, node: string, recordName: string): Promise<ProofInputObject> {
        const slot = StorageHelper.getStorageSlot(TEXTS_SLOT_NAME, node, recordName);

        const [stateRootObj, blockNr] = await this.getStateRoot();
        const { storageProof, accountProof } = await this.getStorageAndAccountProofs(slot, blockNr, resolverAddr);

        const stateRoot = stateRootObj.stateRoot;
        const stateRootBatchHeader = stateRootObj.batch.header;
        const stateRootProof = {
            index: stateRootObj.stateRootIndexInBatch,
            siblings: makeMerkleTreeProof(stateRootObj.batch.stateRoots, stateRootObj.stateRootIndexInBatch),
        };
        const stateTreeWitness = ethers.utils.RLP.encode(accountProof);

        const px = await this.crossChainMessenger.getStorageProof(resolverAddr, storageProof[1].key, {
            blockTag: "latest",
        });

        console.log("px");

        console.log(px);

        return {
            target: resolverAddr,
            stateRoot,
            storageProofs: storageProof,
            stateRootBatchHeader,
            stateRootProof,
            stateTrieWitness: stateTreeWitness,
        };

        //console.log(proofs[0].proof);
    }
    //Return also the account proof
    private async getStorageAndAccountProofs(
        initalSlot: string,
        blockNr: number,
        resolverAddr: string
    ): Promise<{ storageProof: StorageProof[]; accountProof: string[] }> {
        // const getProofResponse = await makeStateTrieProof(this.l2_provider, blockNr, resolverAddr, initalSlot);
        const nr = toRpcHexString(blockNr);
        const getProofResponse = await this.l2_provider.send("eth_getProof", [resolverAddr, [initalSlot], nr]);

        const value = getProofResponse.storageProof[0].value;
        if (value === ZERO_BYTES) {
            console.log("Slot empty");
            //TODO figure out how to proof empty slot
            throw "unimplemented";
        }

        const lastByte = value.substring(value.length - 2);
        const lastBit = parseInt(lastByte, 16) % 2;

        const storageProof: StorageProof = {
            ...getProofResponse.storageProof[0],
            value: ZERO_BYTES,
            storageTrieWitness: ethers.utils.RLP.encode(getProofResponse.storageProof[0].proof),
        };
        const accountProof = getProofResponse.accountProof;

        if (lastBit === 0) {
            console.log("SINGLE SLOT");

            return { storageProof: [storageProof], accountProof };
        }

        const length = BigNumber.from(value).toNumber() + 2;
        const consequentStorageProofs = await this.proofComplexData(initalSlot, length, resolverAddr, blockNr);

        return { storageProof: [storageProof, ...consequentStorageProofs], accountProof };
    }
    private async proofComplexData(initialSlot: string, length: number, resolverAddr: string, blocknr: number) {
        const firstSlot = keccak256(initialSlot);
        const totalSlots = Math.ceil(length / 64);

        const slots = [...Array(totalSlots).keys()].map((i) => BigNumber.from(firstSlot).add(i).toHexString());
        const nr = toRpcHexString(blocknr);

        console.log(nr);
        const getProofResponse = await this.l2_provider.send("eth_getProof", [resolverAddr, [slots[1]], nr]);

        const proofs = getProofResponse.storageProof as StorageProof[];

        return proofs.map((p) => {
            return {
                ...p,
                storageTrieWitness: ethers.utils.RLP.encode(p.proof),
            };
        });
    }

    private async getStateRoot(): Promise<[StateRoot, number]> {
        const batchIndex = await this.crossChainMessenger.contracts.l1.StateCommitmentChain.getTotalBatches();
        const stateRoot = await this.crossChainMessenger.getFirstStateRootInBatch(batchIndex.toNumber() - 1);

        if (!stateRoot) {
            throw "State root not found";
        }
        const magicBlocknr = stateRoot.batch.header.prevTotalElements.add(stateRoot.stateRootIndexInBatch).add(1);
        console.log("total batches");
        console.log(batchIndex);
        console.log("magicBlocknr");
        console.log(magicBlocknr.toHexString());
        return [stateRoot, magicBlocknr.toNumber()];
    }
}
//Get the number total batches from State Commitment Chain
//
