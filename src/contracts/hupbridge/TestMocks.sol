// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract MockToken is ERC20 {
  // --- Storage ---
  bool public taxed;
  uint8 private _decimals = 6;
  // --- Events ---
  // Inherited ERC20 events.
  // --- Modifiers ---
  // Test fixture has no access restrictions.
  // --- Logic ---
  constructor() ERC20("USD", "USD") { _mint(msg.sender, 1_000_000e6); }
  function decimals() public view override returns (uint8) { return _decimals; }
  function setDecimals(uint8 value) external { _decimals = value; }
  function setTaxed(bool value) external { taxed = value; }
  function _transfer(address from, address to, uint256 amount) internal override {
    super._transfer(from, to, taxed ? amount - 1 : amount);
  }
}

contract MockMetadataToken is ERC20 {
  // --- Storage ---
  uint8 private immutable _decimals;
  // --- Events ---
  // Inherited ERC20 events.
  // --- Modifiers ---
  // Test fixture has no access restrictions.
  // --- Logic ---
  constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
    _decimals = decimals_;
    _mint(msg.sender, 100e18);
  }
  function decimals() public view override returns (uint8) { return _decimals; }
}

contract MockAccount {
  // --- Storage ---
  // Stateless smart account fixture.
  // --- Events ---
  // None.
  // --- Modifiers ---
  // Unrestricted for tests only.
  // --- Logic ---
  receive() external payable {}
  function execute(address target, bytes calldata data) external payable {
    (bool ok, bytes memory reason) = target.call{value: msg.value}(data);
    if (!ok) assembly { revert(add(reason, 32), mload(reason)) }
  }
}

contract MockPermitToken is ERC20Permit {
  // --- Storage ---
  // Inherited ERC20 and EIP-2612 state.
  // --- Events ---
  // Inherited ERC20 events.
  // --- Modifiers ---
  // Test fixture has no access restrictions.
  // --- Logic ---
  constructor() ERC20("Permit USD", "PUSD") ERC20Permit("Permit USD") { _mint(msg.sender, 1_000_000e6); }
  function decimals() public pure override returns (uint8) { return 6; }
}

/// @dev Legacy token whose name and symbol are bytes32, like MKR.
contract MockBytes32Token {
  // --- Storage ---
  bytes32 public constant name = "Maker";
  bytes32 public constant symbol = "MKR";
  uint8 public constant decimals = 18;
  uint256 public totalSupply = 100e18;
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;
  // --- Events ---
  event Transfer(address indexed from, address indexed to, uint256 value);
  event Approval(address indexed owner, address indexed spender, uint256 value);
  // --- Modifiers ---
  // Test fixture has no access restrictions.
  // --- Logic ---
  constructor() { balanceOf[msg.sender] = totalSupply; }
  function approve(address spender, uint256 value) external returns (bool) {
    allowance[msg.sender][spender] = value;
    emit Approval(msg.sender, spender, value);
    return true;
  }
  function transfer(address to, uint256 value) external returns (bool) { return _move(msg.sender, to, value); }
  function transferFrom(address from, address to, uint256 value) external returns (bool) {
    allowance[from][msg.sender] -= value;
    return _move(from, to, value);
  }
  function _move(address from, address to, uint256 value) internal returns (bool) {
    balanceOf[from] -= value;
    balanceOf[to] += value;
    emit Transfer(from, to, value);
    return true;
  }
}

/// @dev Permit2 stand-in: the "signature" is abi.encodePacked(owner, nonce) instead of ECDSA.
/// It keeps the properties the vault relies on: the caller is the spender and nonces are single-use.
contract MockPermit2 {
  // --- Storage ---
  struct TokenPermissions { address token; uint256 amount; }
  struct PermitTransferFrom { TokenPermissions permitted; uint256 nonce; uint256 deadline; }
  struct SignatureTransferDetails { address to; uint256 requestedAmount; }
  mapping(address => mapping(uint256 => bool)) public usedNonces;
  // --- Events ---
  // None.
  // --- Modifiers ---
  // Unrestricted for tests only.
  // --- Logic ---
  function permitTransferFrom(PermitTransferFrom calldata permit, SignatureTransferDetails calldata details, address owner, bytes calldata signature) external {
    require(block.timestamp <= permit.deadline, "Expired");
    require(keccak256(signature) == keccak256(abi.encodePacked(owner, permit.nonce)), "Bad signature");
    require(!usedNonces[owner][permit.nonce], "Nonce used");
    require(details.requestedAmount <= permit.permitted.amount, "Too much");
    usedNonces[owner][permit.nonce] = true;
    require(ERC20(permit.permitted.token).transferFrom(owner, details.to, details.requestedAmount));
  }
}
