// Minimal read-only ABI surface from pinned ENSv2 deployment metadata.
import { parseAbi, type Abi } from 'viem';
const state = 'function getState(uint256 anyId) view returns ((uint8 status,uint64 expiry,address latestOwner,uint256 tokenId,uint256 resource) state)';
export const B: Record<'eth'|'registry'|'factory'|'helper'|'resolver', Abi> = {
 eth: parseAbi([state, 'function getSubregistry(string label) view returns (address)']),
 registry: parseAbi([state, 'function getResolver(string label) view returns (address)']),
 factory: parseAbi(['function verifyContract(address proxy) view returns (address implementation)']),
 helper: parseAbi(['function findExactRegistry(bytes name) view returns (address)', 'function findParentRegistry(bytes name) view returns (address)']),
 resolver: parseAbi([
  'function resolve(bytes name,bytes data) view returns (bytes)',
  'function hasRootRoles(uint256 roleBitmap,address account) view returns (bool)',
  'function hasRoles(uint256 resource,uint256 roleBitmap,address account) view returns (bool)',
  'function getAssigneeCount(uint256 resource,uint256 roleBitmap) view returns (uint256 counts,uint256 mask)',
 ]),
};
