// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

error Unauthorized();
error NotAuthorizedAmount(uint256 totalAmount, uint256 authorizedAmount);
error SupplyLimitExceeded(uint256 totalSupply, uint256 tokenSupplyCap);