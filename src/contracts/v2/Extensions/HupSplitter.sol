// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ILSP7Minimal.sol";
import "./IHupSplits.sol";

/**
 * @title Hup Splitter
 * @author Hup Labs
 * @notice One immutable payment split: everything this address receives is divided between its
 *         payees by the shares it was born with. Point a drop's mint payouts at it, name it as a
 *         collection's ERC2981 royalty receiver, or hand it to anything else that pays out — the
 *         payer sends to one address and never learns there is a split behind it.
 * @dev Accrual, not forwarding. `receive()` does nothing but accept, so a marketplace paying
 *      royalties on a 2300-gas stipend can never fail here, and a payee who cannot receive can
 *      never block the others. Each payee's entitlement is derived from everything the split has
 *      ever held (`balance + released`), so income arriving in a hundred separate mints settles
 *      exactly like one payment. `distribute` pushes to everyone and skips a payee whose transfer
 *      reverts; `release` pulls for one and reverts if that transfer fails. Division dust stays
 *      in the contract and is paid out with the next round rather than being rounded away.
 *      Native value, ERC20, and LSP7 are all supported; the split is deliberately not upgradeable
 *      and has no owner, because a share of future royalties is a promise to a collaborator and
 *      not a setting.
 * @custom:version 1.0.0
 * @custom:chain multichain
 * @custom:website https://hup.social
 * @custom:security-contact security@hup.social
 * @custom:emoji 💧
 */
contract HupSplitter is ReentrancyGuard {
  // --- STATE VARIABLES ---

  /// @notice Shares are basis points and must total exactly this — no unallocated remainder.
  uint256 public constant TOTAL_SHARES_BPS = 10_000;

  /// @notice Cap on payees, so `distribute` always fits comfortably inside a block.
  uint256 public constant MAX_PAYEES = 20;

  bytes4 private constant _INTERFACEID_ERC165 = 0x01ffc9a7;

  /// @dev LSP1. Registered so a LUKSO asset transferred with `force == false` — the default a
  ///      Universal Profile sends with — accepts this contract as a recipient.
  bytes4 private constant _INTERFACEID_LSP1 = 0x6bb56a14;

  /// @notice The split's table, fixed at deployment.
  IHupSplits.Payee[] private _payees;

  /// @notice Share of everything this address receives, in basis points (0 = not a payee).
  mapping(address => uint256) public shareBpsOf;

  /// @notice Native value already paid out to a payee.
  mapping(address => uint256) public releasedNative;

  /// @notice Native value already paid out in total, the other half of the accrual base.
  uint256 public totalReleasedNative;

  /// @notice token => payee => amount already paid out.
  mapping(address => mapping(address => uint256)) public releasedToken;

  /// @notice token => amount already paid out in total.
  mapping(address => uint256) public totalReleasedToken;

  // --- EVENTS ---

  event NativeReleased(address indexed account, uint256 amount);
  event TokenReleased(address indexed token, address indexed account, uint256 amount);

  // --- ERRORS ---

  error InvalidAddress();
  error InvalidPayees();
  error InvalidShares(uint256 total);
  error DuplicatePayee(address account);
  error NotAPayee(address account);
  error NothingToRelease();
  error TransferFailed();

  // --- CONSTRUCTOR ---

  /**
   * @param payees_ 1..MAX_PAYEES entries with distinct non-zero accounts and non-zero shares
   *        totalling exactly TOTAL_SHARES_BPS.
   */
  constructor(IHupSplits.Payee[] memory payees_) {
    uint256 count = payees_.length;
    if (count == 0 || count > MAX_PAYEES) revert InvalidPayees();

    uint256 total;

    for (uint256 i = 0; i < count; i++) {
      address account = payees_[i].account;
      uint256 shareBps = payees_[i].shareBps;

      if (account == address(0)) revert InvalidAddress();
      if (shareBps == 0) revert InvalidPayees();
      if (shareBpsOf[account] != 0) revert DuplicatePayee(account);

      shareBpsOf[account] = shareBps;
      _payees.push(payees_[i]);
      total += shareBps;
    }

    if (total != TOTAL_SHARES_BPS) revert InvalidShares(total);
  }

  /// @dev Deliberately empty: the cheapest possible receive, so no payer is ever refused.
  receive() external payable {}

  // --- LOGIC ---

  /**
   * @notice Pays every payee what they are owed of the native balance.
   * @dev Permissionless — a payee, the creator, or a keeper can settle for everyone. A transfer
   *      that reverts leaves that payee's entitlement untouched for a later `release`; it never
   *      costs the others their round.
   */
  function distribute() external nonReentrant returns (uint256 total) {
    uint256 received = address(this).balance + totalReleasedNative;
    uint256 count = _payees.length;

    for (uint256 i = 0; i < count; i++) {
      total += _payNative(_payees[i].account, received, false);
    }
  }

  /**
   * @notice Pays one payee what they are owed of the native balance.
   * @dev Reverts if the transfer fails, unlike `distribute` — a caller asking for one payout
   *      wants to hear that it did not happen.
   */
  function release(address _account) external nonReentrant returns (uint256 amount) {
    if (shareBpsOf[_account] == 0) revert NotAPayee(_account);

    amount = _payNative(_account, address(this).balance + totalReleasedNative, true);

    if (amount == 0) revert NothingToRelease();
  }

  /**
   * @notice Pays every payee what they are owed of one ERC20 or LSP7 balance.
   * @param _isLsp7 True for a LUKSO LSP7 asset, whose `transfer` is not selector-compatible with
   *        ERC20's. A wrong flag reverts rather than moving anything.
   */
  function distributeToken(address _token, bool _isLsp7) external nonReentrant returns (uint256 total) {
    uint256 received = IERC20(_token).balanceOf(address(this)) + totalReleasedToken[_token];
    uint256 count = _payees.length;

    for (uint256 i = 0; i < count; i++) {
      total += _payToken(_token, _isLsp7, _payees[i].account, received, false);
    }
  }

  /**
   * @notice Pays one payee what they are owed of one ERC20 or LSP7 balance.
   */
  function releaseToken(address _token, bool _isLsp7, address _account) external nonReentrant returns (uint256 amount) {
    if (shareBpsOf[_account] == 0) revert NotAPayee(_account);

    uint256 received = IERC20(_token).balanceOf(address(this)) + totalReleasedToken[_token];
    amount = _payToken(_token, _isLsp7, _account, received, true);

    if (amount == 0) revert NothingToRelease();
  }

  // --- VIEW FUNCTIONS ---

  function version() external pure returns (string memory) {
    return "1.0.0";
  }

  /// @notice The full table this split was born with.
  function payees() external view returns (IHupSplits.Payee[] memory) {
    return _payees;
  }

  function payeeCount() external view returns (uint256) {
    return _payees.length;
  }

  /// @notice Native value `_account` can withdraw right now.
  function releasable(address _account) external view returns (uint256) {
    return _owed(address(this).balance + totalReleasedNative, shareBpsOf[_account], releasedNative[_account]);
  }

  /// @notice ERC20/LSP7 balance `_account` can withdraw right now.
  function releasableToken(address _token, address _account) external view returns (uint256) {
    uint256 received = IERC20(_token).balanceOf(address(this)) + totalReleasedToken[_token];

    return _owed(received, shareBpsOf[_account], releasedToken[_token][_account]);
  }

  /**
   * @notice LSP1 hook. Accepts every notification and does nothing with it — the split's whole
   *         accounting is derived from its balance, so it has nothing to record on arrival.
   */
  function universalReceiver(bytes32, bytes calldata) external payable returns (bytes memory) {
    return "";
  }

  function supportsInterface(bytes4 _interfaceId) external pure returns (bool) {
    return _interfaceId == _INTERFACEID_ERC165 || _interfaceId == _INTERFACEID_LSP1;
  }

  // --- INTERNAL FUNCTIONS ---

  /**
   * @dev Sends a payee their share of `_received` native. Marks the payout before the call, so a
   *      re-entrant payee finds nothing left owed; on failure the mark is rolled back — safe
   *      because every entry point holds the reentrancy guard.
   */
  function _payNative(address _account, uint256 _received, bool _mustSucceed) private returns (uint256 amount) {
    amount = _owed(_received, shareBpsOf[_account], releasedNative[_account]);
    if (amount == 0) return 0;

    releasedNative[_account] += amount;
    totalReleasedNative += amount;

    (bool success, ) = _account.call{value: amount}("");

    if (!success) {
      if (_mustSucceed) revert TransferFailed();

      releasedNative[_account] -= amount;
      totalReleasedNative -= amount;

      return 0;
    }

    emit NativeReleased(_account, amount);
  }

  /**
   * @dev The token twin of `_payNative`. LSP7 has no `transferFrom` and its `transfer` takes a
   *      different shape, so the two standards need different calls — the same split the drops
   *      engine makes when it settles a token-priced mint.
   */
  function _payToken(address _token, bool _isLsp7, address _account, uint256 _received, bool _mustSucceed) private returns (uint256 amount) {
    amount = _owed(_received, shareBpsOf[_account], releasedToken[_token][_account]);
    if (amount == 0) return 0;

    releasedToken[_token][_account] += amount;
    totalReleasedToken[_token] += amount;

    bool success;

    // Low level on purpose: a failed transfer has to be survivable inside `distribute`, and the
    // ERC20s that return nothing at all have to count as success.
    if (_isLsp7) {
      (success, ) = _token.call(abi.encodeCall(ILSP7Minimal.transfer, (address(this), _account, amount, true, "")));
    } else {
      (bool called, bytes memory result) = _token.call(abi.encodeCall(IERC20.transfer, (_account, amount)));
      success = called && (result.length == 0 || abi.decode(result, (bool)));
    }

    if (!success) {
      if (_mustSucceed) revert TransferFailed();

      releasedToken[_token][_account] -= amount;
      totalReleasedToken[_token] -= amount;

      return 0;
    }

    emit TokenReleased(_token, _account, amount);
  }

  /**
   * @dev A payee's outstanding share of everything the split has ever held. Integer division
   *      leaves dust behind in the contract, where the next round picks it up.
   */
  function _owed(uint256 _received, uint256 _shareBps, uint256 _released) private pure returns (uint256) {
    if (_shareBps == 0) return 0;

    uint256 earned = (_received * _shareBps) / TOTAL_SHARES_BPS;

    return earned > _released ? earned - _released : 0;
  }
}
