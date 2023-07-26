// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import {IABIResolver} from "./IABIResolver.sol";
import {ResolverBase, BytesUtils} from "../ResolverBase.sol";

abstract contract ABIResolver is IABIResolver, ResolverBase {
    using BytesUtils for bytes;
    mapping(uint64 => mapping(bytes => mapping(bytes32 => mapping(uint256 => bytes)))) versionable_abis;

    /**
     * Sets the ABI associated with an ENS node.
     * Nodes may have one ABI of each content type. To remove an ABI, set it to
     * the empty string.
     * @param name The name to update.
     * @param contentType The content type of the ABI
     * @param data The ABI data.
     */
    function setABI(bytes calldata name, uint256 contentType, bytes calldata data) external virtual {
        // Content types must be powers of 2
        require(((contentType - 1) & contentType) == 0);
        bytes32 node = name.namehash(0);
        bytes memory context = abi.encodePacked(msg.sender);
        versionable_abis[recordVersions[context][node]][context][node][contentType] = data;
        emit ABIChanged(context, name, node, contentType);
    }

    /**
     * Returns the ABI associated with an ENS node.
     * Defined in EIP205.
     * @param node The ENS node to query
     * @param contentTypes A bitwise OR of the ABI formats accepted by the caller.
     * @return contentType The content type of the return value
     * @return data The ABI data
     */
    function ABI(
        bytes calldata context,
        bytes32 node,
        uint256 contentTypes
    ) external view virtual override returns (uint256, bytes memory) {
        mapping(uint256 => bytes) storage abiset = versionable_abis[recordVersions[context][node]][context][node];

        for (uint256 contentType = 1; contentType <= contentTypes; contentType <<= 1) {
            if ((contentType & contentTypes) != 0 && abiset[contentType].length > 0) {
                return (contentType, abiset[contentType]);
            }
        }

        return (0, bytes(""));
    }

    function supportsInterface(bytes4 interfaceID) public view virtual override returns (bool) {
        return interfaceID == type(IABIResolver).interfaceId || super.supportsInterface(interfaceID);
    }
}