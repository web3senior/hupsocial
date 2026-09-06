// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/// @dev Test doubles for everything the HupDrops engine talks to.

contract MockHup {
  struct Session {
    address burner;
    uint256 expiresAt;
  }

  mapping(address => Session) private _sessions;

  function setSession(address owner, address burner, uint256 expiresAt) external {
    _sessions[owner] = Session(burner, expiresAt);
  }

  function userSessions(address owner) external view returns (address, uint256) {
    Session memory s = _sessions[owner];
    return (s.burner, s.expiresAt);
  }
}

/// @dev ERC2771-style forwarder: appends the claimed sender to calldata and bubbles reverts.
contract Forwarder {
  function forward(address target, bytes calldata data, address sender) external payable returns (bytes memory) {
    (bool ok, bytes memory ret) = target.call{ value: msg.value }(abi.encodePacked(data, sender));
    if (!ok) {
      assembly {
        revert(add(ret, 32), mload(ret))
      }
    }
    return ret;
  }
}

contract MockERC20 {
  string public name = "Mock Token";
  string public symbol = "MCK";
  uint8 public decimals = 18;
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;

  function mint(address to, uint256 amount) external {
    balanceOf[to] += amount;
  }

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    return true;
  }

  function transfer(address to, uint256 amount) external returns (bool) {
    _move(msg.sender, to, amount);
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) external returns (bool) {
    uint256 allowed = allowance[from][msg.sender];
    require(allowed >= amount, "allowance");
    allowance[from][msg.sender] = allowed - amount;
    _move(from, to, amount);
    return true;
  }

  function _move(address from, address to, uint256 amount) private {
    require(balanceOf[from] >= amount, "balance");
    balanceOf[from] -= amount;
    balanceOf[to] += amount;
  }
}

/// @dev LSP7-shaped payment token: transfer(from,to,amount,force,data) with operator allowances.
contract MockLSP7Pay {
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public operatorAllowance;

  function mint(address to, uint256 amount) external {
    balanceOf[to] += amount;
  }

  function authorizeOperator(address operator, uint256 amount) external {
    operatorAllowance[msg.sender][operator] = amount;
  }

  function transfer(address from, address to, uint256 amount, bool, bytes calldata) external {
    if (msg.sender != from) {
      uint256 allowed = operatorAllowance[from][msg.sender];
      require(allowed >= amount, "operator");
      operatorAllowance[from][msg.sender] = allowed - amount;
    }
    require(balanceOf[from] >= amount, "balance");
    balanceOf[from] -= amount;
    balanceOf[to] += amount;
  }
}

contract MockLSP26 {
  mapping(address => mapping(address => bool)) private _follows;

  function setFollowing(address follower, address followed, bool value) external {
    _follows[follower][followed] = value;
  }

  function isFollowing(address follower, address addr) external view returns (bool) {
    return _follows[follower][addr];
  }
}

contract MockCommunity {
  struct Status {
    bool isMember;
    bool isPending;
    bool isModerator;
    bool isBanned;
    bool canPost;
  }

  mapping(uint256 => mapping(address => Status)) private _registry;

  function setMember(uint256 id, address user, bool isMember, bool isBanned) external {
    _registry[id][user] = Status(isMember, false, false, isBanned, true);
  }

  function registry(uint256 id, address user) external view returns (bool, bool, bool, bool, bool) {
    Status memory s = _registry[id][user];
    return (s.isMember, s.isPending, s.isModerator, s.isBanned, s.canPost);
  }
}

/// @dev balanceOf(address) gate asset (ERC20/721/LSP7/LSP8 shape).
contract MockGate {
  mapping(address => uint256) public balanceOf;

  function set(address who, uint256 amount) external {
    balanceOf[who] = amount;
  }
}

/// @dev balanceOf(address,uint256) gate asset (ERC1155 shape).
contract Mock1155Gate {
  mapping(address => mapping(uint256 => uint256)) private _bal;

  function set(address who, uint256 id, uint256 amount) external {
    _bal[who][id] = amount;
  }

  function balanceOf(address account, uint256 id) external view returns (uint256) {
    return _bal[account][id];
  }
}

contract RejectingReceiver {
  receive() external payable {
    revert("no thanks");
  }
}

contract PlainContract {}

interface IMintable {
  function mint(address _minter, uint256 _dropId, uint256 _phaseIndex, uint256 _quantity, address _referral) external payable;
}

/// @dev Payout destination that tries to reenter mint() from inside the native push.
contract ReentrantPayout {
  IMintable public immutable engine;
  uint256 public dropId;
  uint256 public phaseIndex;
  bool public swallow;
  bool public attempted;
  bool public reentered;

  constructor(address engine_) {
    engine = IMintable(engine_);
  }

  function arm(uint256 dropId_, uint256 phaseIndex_, bool swallow_) external {
    dropId = dropId_;
    phaseIndex = phaseIndex_;
    swallow = swallow_;
  }

  receive() external payable {
    attempted = true;
    try engine.mint(address(0), dropId, phaseIndex, 1, address(0)) {
      reentered = true;
    } catch {
      if (!swallow) revert("reenter failed");
    }
  }
}

/// @dev 1155 minter that tries to reenter mint() from inside onERC1155Received.
contract Reentrant1155Minter {
  IMintable public immutable engine;
  uint256 public dropId;
  uint256 public phaseIndex;
  bool public attempted;
  bool public reentered;

  constructor(address engine_) {
    engine = IMintable(engine_);
  }

  function arm(uint256 dropId_, uint256 phaseIndex_) external {
    dropId = dropId_;
    phaseIndex = phaseIndex_;
  }

  function doMint(uint256 quantity) external payable {
    engine.mint{ value: msg.value }(address(0), dropId, phaseIndex, quantity, address(0));
  }

  function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
    if (!attempted) {
      attempted = true;
      try engine.mint(address(0), dropId, phaseIndex, 1, address(0)) {
        reentered = true;
      } catch {}
    }
    return this.onERC1155Received.selector;
  }
}
