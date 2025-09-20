// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title Errors
 * @author Aratta Labs
 * @dev This library contains custom errors used throughout the smart contracts.
 * Using custom errors is more gas-efficient than traditional `require` statements
 * with string messages, as the error data is stored as a selector and is logged
 * as part of the transaction's revert reason. This provides more granular feedback.
 */
library Errors {
    // ---------------------------------------------------------------- //
    //                      MINTING AND SUPPLY ERRORS                   //
    // ---------------------------------------------------------------- //

    /** @dev Emitted when the total supply limit of the NFT collection has been reached. */
    error MaxSupplyExceeded();

    /** @dev Emitted when a minting operation is attempted during an invalid or inactive phase. */
    error InvalidPhase();

    /** @dev Emitted when the current minting phase is not active. */
    error PhaseNotActive();

    /** @dev Emitted when a wallet has exceeded the maximum number of NFTs it can mint. */
    error MaxMintPerWalletExceeded();

    /** @dev Emitted when the supply for the current minting phase has been exhausted. */
    error PhaseSupplyExceeded();

    /** @dev Emitted when the requested number of NFTs to mint exceeds the allowed maximum. */
    error MaxMintExceeded();

    /** @dev Emitted when an address attempts to mint but is not on the whitelist. */
    error NotWhitelisted(bytes32 pollId, address sender);

    /** @dev Emitted when an address attempts to mint but does not hold a required membership card. */
    error NotAMemberCardHolder();

    /** @dev Emitted when a function requiring a specific cooldown period is called before it's over. */
    error CooldownPeriodNotPassed();

    error Reverted();
    error Unauthorized();
    error TooEarly(uint256 now);
    error TooLate(uint256 now);
    error PriceNotMet(uint256 value, uint256 amount);
    error NotAuthorizedAmount(uint256 totalAmount, uint256 authorizedAmount);
    error RepetitiveResponse(address sender);
    error WhitelistOnly();
    error NotHolder(uint256, uint256);

    //"Poll is not in a voting period."
    error PollNotOpen();
    error PollClosed();
    error AlreadyVoted();
    error InvalidOption();
    error NotEligible();

    // ---------------------------------------------------------------- //
    //                      TOKEN LOGIC ERRORS                          //
    // ---------------------------------------------------------------- //

    /** @dev Emitted when a token's level-up attempt is made but it has already reached its maximum level. */
    error MaxLevelReached();

    /** @dev Emitted when a token's level-up attempt fails due to insufficient experience points (XP). */
    error NotEnoughXP(uint256 requiredXP, uint256 currentXP);

    /** @dev Emitted when a token's level-down attempt is made but it is already at its minimum level. */
    error AlreadyAtMinLevel();

    // ---------------------------------------------------------------- //
    //                      ACCESS CONTROL ERRORS                       //
    // ---------------------------------------------------------------- //

    /** @dev Emitted when a function with `onlyOwner` is called by an address that is not the contract owner. */
    error UnauthorizedOwner();

    /** @dev Emitted when a function with an operator check is called by an address that is not an approved operator. */
    error UnauthorizedOperator(address operator);

    error InvalidAddress();

    // ---------------------------------------------------------------- //
    //                      BALANCE & PAYMENT ERRORS                    //
    // ---------------------------------------------------------------- //

    /** @dev Emitted when the sent ETH value is less than the required amount for a transaction. */
    error InsufficientPayment(uint256 sent);

    /** @dev Emitted when the contract's native token balance is insufficient for a withdrawal or transfer. */
    error InsufficientContractBalance();

    /** @dev Emitted when a requested amount for an operation (e.g., transfer, burn) is not fully authorized. */
    error UnauthorizedAmount(uint256 totalAmount, uint256 authorizedAmount);
}
