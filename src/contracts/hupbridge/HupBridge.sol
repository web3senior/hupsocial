// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LSP7DigitalAssetInitAbstract} from "@lukso/lsp7-contracts/contracts/LSP7DigitalAssetInitAbstract.sol";

/// @dev Uniswap Permit2 SignatureTransfer, deployed at the same address on every major EVM chain.
interface IPermit2 {
  struct TokenPermissions { address token; uint256 amount; }
  struct PermitTransferFrom { TokenPermissions permitted; uint256 nonce; uint256 deadline; }
  struct SignatureTransferDetails { address to; uint256 requestedAmount; }
  function permitTransferFrom(PermitTransferFrom calldata permit, SignatureTransferDetails calldata transferDetails, address owner, bytes calldata signature) external;
}

/**
 * @title Hup Bridge Vault
 * @notice One per source chain. Locks any standard ERC20 or the native coin for a LUKSO mirror and
 *         releases it when the Hup signer attests a burn on LUKSO. Users send every transaction and
 *         pay every fee; the signer only signs, so it never holds funds or gas.
 * @dev Each deposit pays a flat fee in the native coin, so any asset can be charged the same way and
 *      amounts cross unchanged. Fees are kept apart from native escrow, so a release can never touch
 *      them. The fee can be changed by the owner but never above the cap fixed at deployment.
 */
contract HupBridgeVault is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
  using SafeERC20 for IERC20;

  // --- Storage ---
  address public constant NATIVE = address(0);
  bytes32 private constant RELEASE_TYPEHASH = keccak256("Release(bytes32 burnId,address token,address recipient,uint256 amount)");

  IPermit2 public immutable permit2;
  /// @notice The highest the fee can ever be set, fixed at deployment.
  uint256 public immutable maxBridgeFee;
  string private _nativeName;
  string private _nativeSymbol;
  address public signer;
  /// @notice The flat native fee every deposit pays.
  uint256 public bridgeFee;
  uint256 public depositNonce;
  /// @notice Escrow per token: exactly what the LUKSO mirrors of that token stand for.
  mapping(address => uint256) public locked;
  /// @notice Native fees taken and not yet withdrawn.
  uint256 public feesAccrued;
  /// @notice LUKSO burns already paid out.
  mapping(bytes32 => bool) public released;
  /// @notice Share of a token's escrow (basis points) that may be released per 24 hours. Bounds what
  ///         a leaked signer key can take before anyone pauses the vault.
  uint16 public dailyReleaseBps;
  /// @notice Per token: an amount that may always be released per 24 hours, whatever its share.
  mapping(address => uint256) public dailyReleaseFloor;
  struct ReleaseWindow { uint64 start; uint256 used; uint256 base; }
  mapping(address => ReleaseWindow) public releaseWindows;

  // --- Events ---
  event Deposited(uint256 indexed nonce, address indexed token, address indexed sender, address recipient, uint256 amount, uint256 fee, uint8 decimals, string name, string symbol);
  event Released(bytes32 indexed burnId, address indexed token, address indexed recipient, uint256 amount);
  event SignerSet(address signer);
  event FeeSet(uint256 fee);
  event FeesWithdrawn(address indexed to, uint256 amount);
  event ReleaseLimitSet(uint16 bps);
  event ReleaseFloorSet(address indexed token, uint256 amount);

  // --- Errors ---
  error InvalidAddress();
  error InvalidAmount();
  error FeeTooHigh();
  error FeeTooLow();
  error DailyLimit();
  error UnsupportedToken();
  error UnsupportedTransfer();
  error BadSignature();
  error AlreadyReleased();
  error NotAllowed();
  error TransferFailed();

  // --- Modifiers ---
  modifier onlyGuardian() {
    if (msg.sender != owner() && msg.sender != signer) revert NotAllowed();
    _;
  }

  // --- Logic ---
  constructor(address signer_, address permit2_, uint256 bridgeFee_, uint256 maxBridgeFee_, uint16 dailyReleaseBps_, string memory nativeName_, string memory nativeSymbol_, address admin)
    EIP712("HupBridgeVault", "1") {
    if (signer_ == address(0) || admin == address(0)) revert InvalidAddress();
    if (permit2_ != address(0) && permit2_.code.length == 0) revert InvalidAddress();
    if (bridgeFee_ > maxBridgeFee_) revert FeeTooHigh();
    if (dailyReleaseBps_ == 0 || dailyReleaseBps_ > 10_000) revert InvalidAmount();
    dailyReleaseBps = dailyReleaseBps_;
    if (!_validMetadata(nativeName_, nativeSymbol_)) revert UnsupportedToken();
    signer = signer_;
    permit2 = IPermit2(permit2_);
    bridgeFee = bridgeFee_;
    maxBridgeFee = maxBridgeFee_;
    _nativeName = nativeName_;
    _nativeSymbol = nativeSymbol_;
    _transferOwnership(admin);
  }

  function bridgeVersion() external pure returns (uint256) { return 1; }

  /// @notice The name, symbol and decimals a deposit of `token` carries to LUKSO, read from the token.
  ///         Accepts string and legacy bytes32 metadata (e.g. MKR).
  function metadataOf(address token) public view returns (uint8 decimals_, string memory name_, string memory symbol_) {
    if (token == NATIVE) return (18, _nativeName, _nativeSymbol);
    if (token.code.length == 0) revert UnsupportedToken();
    (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
    if (!ok || data.length < 32) revert UnsupportedToken();
    uint256 value = abi.decode(data, (uint256));
    if (value > 18) revert UnsupportedToken();
    decimals_ = uint8(value);
    name_ = _readString(token, "name()");
    symbol_ = _readString(token, "symbol()");
    if (!_validMetadata(name_, symbol_)) revert UnsupportedToken();
  }

  /// @notice ERC20 deposits pay `bridgeFee` as msg.value; any excess is refunded.
  function deposit(address token, address recipient, uint256 amount) external payable whenNotPaused nonReentrant returns (uint256) {
    return _depositToken(token, recipient, amount, false, "");
  }

  /// @notice EIP-2612: `permitData` is abi.encode(value, deadline, v, r, s) signed for this vault.
  function depositWithPermit(address token, address recipient, uint256 amount, bytes calldata permitData) external payable whenNotPaused nonReentrant returns (uint256) {
    (uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) = abi.decode(permitData, (uint256, uint256, uint8, bytes32, bytes32));
    // A front-run permit still leaves the allowance in place, so its failure alone is not fatal.
    try IERC20Permit(token).permit(msg.sender, address(this), value, deadline, v, r, s) {} catch {}
    return _depositToken(token, recipient, amount, false, "");
  }

  /// @notice Permit2 SignatureTransfer: `permitData` is abi.encode(nonce, deadline, signature).
  function depositWithPermit2(address token, address recipient, uint256 amount, bytes calldata permitData) external payable whenNotPaused nonReentrant returns (uint256) {
    if (address(permit2) == address(0)) revert NotAllowed();
    return _depositToken(token, recipient, amount, true, permitData);
  }

  /// @notice Bridges `amount` of the native coin; msg.value covers it plus `bridgeFee`.
  function depositNative(address recipient, uint256 amount) external payable whenNotPaused nonReentrant returns (uint256) {
    if (msg.value < amount) revert InvalidAmount();
    return _record(NATIVE, recipient, amount, msg.value - amount);
  }

  /// @notice Pays out a LUKSO burn the signer attested. Anyone may submit it; the recipient is fixed.
  function release(bytes32 burnId, address token, address recipient, uint256 amount, bytes calldata signature) external whenNotPaused nonReentrant {
    if (released[burnId]) revert AlreadyReleased();
    if (recipient == address(0) || amount == 0) revert InvalidAmount();
    bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(RELEASE_TYPEHASH, burnId, token, recipient, amount)));
    if (!SignatureChecker.isValidSignatureNow(signer, digest, signature)) revert BadSignature();
    released[burnId] = true;
    _spendReleaseWindow(token, amount);
    // Underflows (and reverts) rather than ever paying more than this token's escrow.
    locked[token] -= amount;
    _pay(token, recipient, amount);
    emit Released(burnId, token, recipient, amount);
  }

  function setSigner(address signer_) external onlyOwner {
    if (signer_ == address(0)) revert InvalidAddress();
    signer = signer_;
    emit SignerSet(signer_);
  }

  /// @notice How much of `token` can still be released in the current 24-hour window, and when the
  ///         next window opens.
  function releasableToday(address token) public view returns (uint256 available, uint256 resetsAt) {
    ReleaseWindow memory window = releaseWindows[token];
    bool fresh = block.timestamp >= window.start + 1 days;
    uint256 limit = _releaseLimit(token, fresh ? locked[token] : window.base);
    uint256 used = fresh ? 0 : window.used;
    available = limit > used ? limit - used : 0;
    resetsAt = fresh ? block.timestamp + 1 days : window.start + 1 days;
  }

  /// @notice The share of each token's escrow releasable per 24 hours, in basis points (1–10,000).
  function setDailyReleaseBps(uint16 bps) external onlyOwner {
    if (bps == 0 || bps > 10_000) revert InvalidAmount();
    dailyReleaseBps = bps;
    emit ReleaseLimitSet(bps);
  }

  /// @notice An amount of `token` always releasable per 24 hours, so everyday withdrawals never wait.
  function setDailyReleaseFloor(address token, uint256 amount) external onlyOwner {
    dailyReleaseFloor[token] = amount;
    emit ReleaseFloorSet(token, amount);
  }

  /// @notice Applies to deposits from now on, never above maxBridgeFee.
  function setBridgeFee(uint256 fee) external onlyOwner {
    if (fee > maxBridgeFee) revert FeeTooHigh();
    bridgeFee = fee;
    emit FeeSet(fee);
  }

  function withdrawFees(address to, uint256 amount) external onlyOwner nonReentrant {
    if (to == address(0)) revert InvalidAddress();
    feesAccrued -= amount;
    _pay(NATIVE, to, amount);
    emit FeesWithdrawn(to, amount);
  }

  /// @notice The owner or the signer can stop the bridge; only the owner can restart it.
  function pause() external onlyGuardian { _pause(); }
  function unpause() external onlyOwner { _unpause(); }

  function _depositToken(address token, address recipient, uint256 amount, bool viaPermit2, bytes memory permitData) internal returns (uint256) {
    if (token == NATIVE) revert UnsupportedToken();
    uint256 beforeBalance = IERC20(token).balanceOf(address(this));
    if (viaPermit2) _pullPermit2(token, amount, permitData);
    else IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    // Exact accounting: transfer-tax and rebasing-on-transfer tokens are refused.
    if (IERC20(token).balanceOf(address(this)) != beforeBalance + amount) revert UnsupportedTransfer();
    return _record(token, recipient, amount, msg.value);
  }

  function _pullPermit2(address token, uint256 amount, bytes memory permitData) internal {
    (uint256 permitNonce, uint256 deadline, bytes memory signature) = abi.decode(permitData, (uint256, uint256, bytes));
    // Permit2 binds the signature to this vault as spender; the owner is always the caller.
    permit2.permitTransferFrom(
      IPermit2.PermitTransferFrom(IPermit2.TokenPermissions(token, amount), permitNonce, deadline),
      IPermit2.SignatureTransferDetails(address(this), amount),
      msg.sender,
      signature
    );
  }

  /// @dev `paid` is the native value left for the fee; anything above it goes back to the caller.
  function _record(address token, address recipient, uint256 amount, uint256 paid) internal returns (uint256 nonce) {
    if (recipient == address(0) || amount == 0) revert InvalidAmount();
    uint256 fee = bridgeFee;
    if (paid < fee) revert FeeTooLow();
    (uint8 decimals_, string memory name_, string memory symbol_) = metadataOf(token);
    locked[token] += amount;
    feesAccrued += fee;
    nonce = depositNonce++;
    emit Deposited(nonce, token, msg.sender, recipient, amount, fee, decimals_, name_, symbol_);
    _pay(NATIVE, msg.sender, paid - fee);
  }

  function _releaseLimit(address token, uint256 base) internal view returns (uint256) {
    uint256 share = (base * dailyReleaseBps) / 10_000;
    uint256 floor = dailyReleaseFloor[token];
    return share > floor ? share : floor;
  }

  /// @dev The window measures its share against the escrow at its start, so releases inside it
  ///      cannot shrink (or deposits inflate) what the rest of the day allows.
  function _spendReleaseWindow(address token, uint256 amount) internal {
    ReleaseWindow storage window = releaseWindows[token];
    if (block.timestamp >= window.start + 1 days) {
      window.start = uint64(block.timestamp);
      window.used = 0;
      window.base = locked[token];
    }
    if (window.used + amount > _releaseLimit(token, window.base)) revert DailyLimit();
    window.used += amount;
  }

  function _pay(address token, address to, uint256 amount) internal {
    if (amount == 0) return;
    if (token == NATIVE) {
      (bool ok,) = payable(to).call{value: amount}("");
      if (!ok) revert TransferFailed();
    } else {
      IERC20(token).safeTransfer(to, amount);
    }
  }

  function _readString(address token, string memory signature) internal view returns (string memory) {
    (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature(signature));
    if (!ok || data.length < 32) revert UnsupportedToken();
    if (data.length > 32) return abi.decode(data, (string));
    bytes32 raw = bytes32(data);
    uint256 length;
    while (length < 32 && raw[length] != 0) length++;
    bytes memory text = new bytes(length);
    for (uint256 i; i < length; i++) text[i] = raw[i];
    return string(text);
  }

  function _validMetadata(string memory name_, string memory symbol_) internal pure returns (bool) {
    return bytes(name_).length > 0 && bytes(name_).length <= 128 && bytes(symbol_).length > 0 && bytes(symbol_).length <= 32;
  }
}

/**
 * @title Hup Mirror Token
 * @notice The LUKSO copy of a token locked in a HupBridgeVault. 18 decimals; every unit stands for a
 *         unit of the source token in escrow, scaled from its own decimals.
 * @dev A clone per (source chain, source token). The bridge is its ERC725Y owner and its only minter
 *      and burner.
 */
contract HupMirrorToken is LSP7DigitalAssetInitAbstract {
  // --- Storage ---
  uint256 public sourceChainId;
  address public sourceToken;

  // --- Errors ---
  error NotBridge();

  // --- Modifiers ---
  modifier onlyBridge() {
    if (msg.sender != owner()) revert NotBridge();
    _;
  }

  // --- Logic ---
  constructor() {
    _disableInitializers();
  }

  function initialize(string calldata name_, string calldata symbol_, uint256 sourceChainId_, address sourceToken_) external initializer {
    LSP7DigitalAssetInitAbstract._initialize(name_, symbol_, msg.sender, 0, false);
    sourceChainId = sourceChainId_;
    sourceToken = sourceToken_;
  }

  /// @notice Forced, so an EOA or a contract without LSP1 still receives.
  function mint(address to, uint256 amount) external onlyBridge {
    _mint(to, amount, true, "");
  }

  /// @dev The bridge only ever burns from its own caller, so no operator authorization is needed.
  function burnFrom(address holder, uint256 amount) external onlyBridge {
    _burn(holder, amount, "");
  }
}

/**
 * @title Hup LUKSO Bridge
 * @notice Mints LSP7 mirrors for deposits the Hup signer attests, and burns them for the way back.
 *         Users submit their own claims (or a relayer does for them); the signer never sends a
 *         transaction. The first claim of a token creates its mirror and writes its LSP4Metadata.
 */
contract HupLuksoBridge is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
  // --- Storage ---
  /// @dev LSP4Metadata, the one ERC725Y key this bridge ever writes on a mirror.
  bytes32 private constant LSP4_METADATA_KEY = 0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e;
  bytes32 private constant CLAIM_TYPEHASH = keccak256(
    "Claim(uint256 sourceChainId,address vault,uint256 depositNonce,address sourceToken,uint8 decimals,string name,string symbol,address recipient,uint256 amount,bytes metadata)"
  );

  struct Claim {
    uint256 sourceChainId;
    address vault;
    uint256 depositNonce;
    address sourceToken;
    uint8 decimals;
    string name;
    string symbol;
    address recipient;
    uint256 amount;
    bytes metadata;
  }

  struct Mirror { address token; uint256 scale; }

  address public immutable implementation;
  /// @notice The highest the burn fee can ever be set, fixed at deployment.
  uint256 public immutable maxBurnFee;
  address public signer;
  /// @notice The flat LYX fee every burn pays. Claims are free.
  uint256 public burnFee;
  /// @notice LYX fees taken and not yet withdrawn.
  uint256 public feesAccrued;
  uint256 public burnNonce;
  /// @notice The vault each source chain releases from; zero means the chain is not open.
  mapping(uint256 => address) public vaultOf;
  mapping(uint256 => mapping(address => Mirror)) public mirrors;
  mapping(bytes32 => bool) public claimed;

  // --- Events ---
  event MirrorCreated(uint256 indexed sourceChainId, address indexed sourceToken, address indexed mirror, uint8 decimals, string name, string symbol);
  event Claimed(bytes32 indexed depositId, uint256 indexed sourceChainId, address indexed sourceToken, address recipient, uint256 amount);
  event Burned(bytes32 indexed burnId, uint256 indexed sourceChainId, address indexed sourceToken, address sender, address recipient, uint256 amount);
  event VaultSet(uint256 indexed sourceChainId, address vault);
  event SignerSet(address signer);
  event FeeSet(uint256 fee);
  event FeesWithdrawn(address indexed to, uint256 amount);

  // --- Errors ---
  error InvalidAddress();
  error InvalidAmount();
  error FeeTooHigh();
  error FeeTooLow();
  error TransferFailed();
  error UnknownChain();
  error UnknownMirror();
  error BadSignature();
  error AlreadyClaimed();
  error InvalidMetadata();
  error NotAllowed();

  // --- Modifiers ---
  modifier onlyGuardian() {
    if (msg.sender != owner() && msg.sender != signer) revert NotAllowed();
    _;
  }

  // --- Logic ---
  constructor(address signer_, uint256 burnFee_, uint256 maxBurnFee_, address admin) EIP712("HupLuksoBridge", "1") {
    if (signer_ == address(0) || admin == address(0)) revert InvalidAddress();
    if (burnFee_ > maxBurnFee_) revert FeeTooHigh();
    signer = signer_;
    burnFee = burnFee_;
    maxBurnFee = maxBurnFee_;
    implementation = address(new HupMirrorToken());
    _transferOwnership(admin);
  }

  function bridgeVersion() external pure returns (uint256) { return 1; }

  function depositId(uint256 sourceChainId, address vault, uint256 nonce) public pure returns (bytes32) {
    return keccak256(abi.encode(sourceChainId, vault, nonce));
  }

  /// @notice The mirror address for a source asset, known before its first claim.
  function predictMirror(uint256 sourceChainId, address sourceToken) external view returns (address) {
    return Clones.predictDeterministicAddress(implementation, _salt(sourceChainId, sourceToken));
  }

  /// @notice Mints a deposit the signer attested. Anyone may submit it; the recipient is fixed.
  function claim(Claim calldata c, bytes calldata signature) external whenNotPaused nonReentrant returns (address mirror) {
    if (c.vault == address(0) || c.vault != vaultOf[c.sourceChainId]) revert UnknownChain();
    if (c.recipient == address(0) || c.amount == 0) revert InvalidAmount();
    if (!SignatureChecker.isValidSignatureNow(signer, _claimDigest(c), signature)) revert BadSignature();
    bytes32 id = depositId(c.sourceChainId, c.vault, c.depositNonce);
    if (claimed[id]) revert AlreadyClaimed();
    claimed[id] = true;
    Mirror memory asset = mirrors[c.sourceChainId][c.sourceToken];
    if (asset.token == address(0)) asset = _create(c);
    HupMirrorToken(payable(asset.token)).mint(c.recipient, c.amount * asset.scale);
    emit Claimed(id, c.sourceChainId, c.sourceToken, c.recipient, c.amount);
    return asset.token;
  }

  /// @notice Burns `sourceAmount` (in source-token units) of the caller's mirror for release on the
  ///         source chain. The signer then attests the burn and the user releases it there.
  ///         msg.value pays `burnFee` in LYX; any excess is refunded.
  function burn(uint256 sourceChainId, address sourceToken, address recipient, uint256 sourceAmount) external payable whenNotPaused nonReentrant returns (bytes32 burnId) {
    if (vaultOf[sourceChainId] == address(0)) revert UnknownChain();
    if (recipient == address(0) || sourceAmount == 0) revert InvalidAmount();
    uint256 fee = burnFee;
    if (msg.value < fee) revert FeeTooLow();
    Mirror memory asset = mirrors[sourceChainId][sourceToken];
    if (asset.token == address(0)) revert UnknownMirror();
    HupMirrorToken(payable(asset.token)).burnFrom(msg.sender, sourceAmount * asset.scale);
    feesAccrued += fee;
    burnId = keccak256(abi.encode(block.chainid, address(this), burnNonce++));
    emit Burned(burnId, sourceChainId, sourceToken, msg.sender, recipient, sourceAmount);
    _send(msg.sender, msg.value - fee);
  }

  /// @notice Applies to burns from now on, never above maxBurnFee.
  function setBurnFee(uint256 fee) external onlyOwner {
    if (fee > maxBurnFee) revert FeeTooHigh();
    burnFee = fee;
    emit FeeSet(fee);
  }

  function withdrawFees(address to, uint256 amount) external onlyOwner nonReentrant {
    if (to == address(0)) revert InvalidAddress();
    feesAccrued -= amount;
    _send(to, amount);
    emit FeesWithdrawn(to, amount);
  }

  /// @notice Opens a source chain, or closes it to new burns with the zero address. Claims check it too.
  function setVault(uint256 sourceChainId, address vault) external onlyOwner {
    if (sourceChainId == block.chainid) revert UnknownChain();
    vaultOf[sourceChainId] = vault;
    emit VaultSet(sourceChainId, vault);
  }

  function setSigner(address signer_) external onlyOwner {
    if (signer_ == address(0)) revert InvalidAddress();
    signer = signer_;
    emit SignerSet(signer_);
  }

  /// @notice Rewrites a mirror's LSP4Metadata (its icon and description) and nothing else.
  function setMirrorMetadata(uint256 sourceChainId, address sourceToken, bytes calldata metadata) external onlyGuardian {
    address mirror = mirrors[sourceChainId][sourceToken].token;
    if (mirror == address(0)) revert UnknownMirror();
    HupMirrorToken(payable(mirror)).setData(LSP4_METADATA_KEY, metadata);
  }

  function pause() external onlyGuardian { _pause(); }
  function unpause() external onlyOwner { _unpause(); }

  function _create(Claim calldata c) internal returns (Mirror memory asset) {
    if (c.decimals > 18 || (c.sourceToken == address(0) && c.decimals != 18)) revert InvalidMetadata();
    if (bytes(c.name).length == 0 || bytes(c.name).length > 128 || bytes(c.symbol).length == 0 || bytes(c.symbol).length > 32) revert InvalidMetadata();
    address token = Clones.cloneDeterministic(implementation, _salt(c.sourceChainId, c.sourceToken));
    HupMirrorToken(payable(token)).initialize(c.name, c.symbol, c.sourceChainId, c.sourceToken);
    if (c.metadata.length != 0) HupMirrorToken(payable(token)).setData(LSP4_METADATA_KEY, c.metadata);
    asset = Mirror(token, 10 ** (18 - c.decimals));
    mirrors[c.sourceChainId][c.sourceToken] = asset;
    emit MirrorCreated(c.sourceChainId, c.sourceToken, token, c.decimals, c.name, c.symbol);
  }

  function _claimDigest(Claim calldata c) internal view returns (bytes32) {
    return _hashTypedDataV4(keccak256(abi.encode(
      CLAIM_TYPEHASH, c.sourceChainId, c.vault, c.depositNonce, c.sourceToken, c.decimals,
      keccak256(bytes(c.name)), keccak256(bytes(c.symbol)), c.recipient, c.amount, keccak256(c.metadata)
    )));
  }

  function _salt(uint256 sourceChainId, address sourceToken) internal pure returns (bytes32) {
    return keccak256(abi.encode(sourceChainId, sourceToken));
  }

  /// @dev `call`, never `transfer`, so a Universal Profile's receive logic is not starved of gas.
  function _send(address to, uint256 amount) internal {
    if (amount == 0) return;
    (bool ok,) = payable(to).call{value: amount}("");
    if (!ok) revert TransferFailed();
  }
}
