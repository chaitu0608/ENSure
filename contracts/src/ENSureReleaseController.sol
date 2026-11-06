// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRegistryV2 {
    function getResolver(string calldata label) external view returns (address);
}

interface IResolverV2 {
    function setContenthash(bytes calldata name, bytes calldata hash) external;
    function setText(bytes calldata name, string calldata key, string calldata value) external;
    function multicall(bytes[] calldata calls) external returns (bytes[] memory);
}

/// @notice Selects which approved release the production ENS name serves.
/// @dev Unaudited. Needs ROLE_SET_CONTENTHASH (root) and ROLE_SET_TEXT on the two text keys.
contract ENSureReleaseController {
    struct Release {
        bytes contenthash;
        string manifestCid;
        bytes32 manifestDigest;
        bytes32 commitDigest;
        bytes32 previousReleaseId;
        address approver;
        uint64 approvedAt;
    }

    string public constant PROD_LABEL = "prod";
    string public constant KEY_MANIFEST = "ensure.manifest";
    string public constant KEY_RELEASE = "ensure.release";

    address public immutable ownerSafe;
    address public immutable recoveryAuthority;
    bytes32 public immutable projectNode;
    IRegistryV2 public immutable productionRegistry;
    IResolverV2 public immutable productionResolver;
    bytes public dnsName; // set once: bytes can't be immutable

    bytes32 public currentReleaseId;
    mapping(bytes32 => Release) private _releases;

    event ReleasePromoted(
        bytes32 indexed releaseId,
        bytes32 indexed previousReleaseId,
        address indexed approver,
        string manifestCid,
        bytes32 manifestDigest,
        bytes32 commitDigest
    );
    event ReleaseRolledBack(bytes32 indexed releaseId, bytes32 indexed fromReleaseId, address indexed caller);
    event ReleaseRecovered(
        bytes32 indexed releaseId, bytes32 indexed fromReleaseId, address indexed caller, string reason
    );

    error NotOwner();
    error NotRecoveryAuthority();
    error ResolverMismatch(address expected, address actual);
    error EmptyValue();
    error UnknownRelease(bytes32 releaseId);
    error ReleaseExists(bytes32 releaseId);
    error InvalidConfig();

    constructor(
        address owner_,
        address recovery_,
        bytes32 node_,
        IRegistryV2 registry_,
        IResolverV2 resolver_,
        bytes memory dnsName_
    ) {
        if (
            owner_ == address(0) || recovery_ == address(0) || owner_ == recovery_ || node_ == bytes32(0)
                || address(registry_) == address(0) || address(resolver_) == address(0) || dnsName_.length == 0
        ) revert InvalidConfig();
        ownerSafe = owner_;
        recoveryAuthority = recovery_;
        projectNode = node_;
        productionRegistry = registry_;
        productionResolver = resolver_;
        dnsName = dnsName_;
    }

    function promote(
        bytes calldata contenthashBytes,
        string calldata manifestCid,
        bytes32 manifestDigest,
        bytes32 commitDigest
    ) external returns (bytes32 releaseId) {
        if (msg.sender != ownerSafe) revert NotOwner();
        if (
            contenthashBytes.length == 0 || bytes(manifestCid).length == 0 || manifestDigest == bytes32(0)
                || commitDigest == bytes32(0)
        ) revert EmptyValue();

        releaseId = keccak256(abi.encode(projectNode, keccak256(contenthashBytes), manifestDigest, commitDigest));
        if (_releases[releaseId].approvedAt != 0) revert ReleaseExists(releaseId);

        bytes32 previous = currentReleaseId;
        _releases[releaseId] = Release(
            contenthashBytes, manifestCid, manifestDigest, commitDigest, previous, msg.sender, uint64(block.timestamp)
        );
        _apply(releaseId);
        emit ReleasePromoted(releaseId, previous, msg.sender, manifestCid, manifestDigest, commitDigest);
    }

    function rollback(bytes32 releaseId) external {
        if (msg.sender != ownerSafe) revert NotOwner();
        bytes32 from = currentReleaseId;
        _apply(releaseId);
        emit ReleaseRolledBack(releaseId, from, msg.sender);
    }

    function recover(bytes32 releaseId, string calldata reason) external {
        if (msg.sender != recoveryAuthority) revert NotRecoveryAuthority();
        if (bytes(reason).length == 0) revert EmptyValue();
        bytes32 from = currentReleaseId;
        _apply(releaseId);
        emit ReleaseRecovered(releaseId, from, msg.sender, reason);
    }

    function getRelease(bytes32 releaseId) external view returns (Release memory) {
        return _releases[releaseId];
    }

    function _apply(bytes32 releaseId) private {
        Release storage r = _releases[releaseId];
        if (r.approvedAt == 0) revert UnknownRelease(releaseId);

        address actual = productionRegistry.getResolver(PROD_LABEL);
        if (actual != address(productionResolver)) revert ResolverMismatch(address(productionResolver), actual);

        bytes memory name = dnsName;
        bytes[] memory calls = new bytes[](3);
        calls[0] = abi.encodeCall(IResolverV2.setContenthash, (name, r.contenthash));
        calls[1] = abi.encodeCall(IResolverV2.setText, (name, KEY_MANIFEST, r.manifestCid));
        calls[2] = abi.encodeCall(IResolverV2.setText, (name, KEY_RELEASE, _hex(releaseId)));

        currentReleaseId = releaseId;
        productionResolver.multicall(calls);
    }

    function _hex(bytes32 v) private pure returns (string memory) {
        bytes memory out = new bytes(66);
        out[0] = "0";
        out[1] = "x";
        bytes16 digits = "0123456789abcdef";
        for (uint256 i; i < 32; ++i) {
            out[2 + i * 2] = digits[uint8(v[i]) >> 4];
            out[3 + i * 2] = digits[uint8(v[i]) & 0x0f];
        }
        return string(out);
    }
}
