
 contract LuksoPoll {
    // --------------------
    // Events
    // --------------------
    event VoteCast(address indexed voter, uint256 indexed option, uint256 weight);
    event PollCreated(
        string question,
        string[] options,
        uint64 startTime,
        uint64 endTime,
        address tokenGate,
        uint256 minBalance,
        bool contractsOnly
    );

    // --------------------
    // Storage
    // --------------------
    string public question;                 // Human-readable prompt
    string[] public options;                // Option labels

    uint64 public immutable startTime;      // Unix seconds
    uint64 public immutable endTime;        // Unix seconds

    // Eligibility config
    address public immutable tokenGate;     // Address of LSP7 token to gate by (0x0 if none)
    uint256 public immutable minBalance;    // Minimum balance to be eligible
    bool public immutable contractsOnly;    // If true, only contract accounts (e.g., UPs) can vote

    // Tallying
    mapping(uint256 => uint256) public votes;        // optionIndex => weight (1 per address by default)
    mapping(address => bool) public hasVoted;        // one vote per address
    mapping(address => uint256) public choiceOf;     // optional: track chosen option per voter

    // --------------------
    // Errors
    // --------------------
    error PollNotOpen();
    error PollClosed();
    error AlreadyVoted();
    error InvalidOption();
    error NotEligible();

    // --------------------
    // Constructor
    // --------------------
    constructor(
        string memory _question,
        string[] memory _options,
        uint64 _startTime,
        uint64 _endTime,
        address _tokenGate,
        uint256 _minBalance,
        bool _contractsOnly
    ) {
        require(_options.length >= 2, "Need at least 2 options");
        require(_endTime > _startTime, "endTime must be > startTime");

        question = _question;
        options = _options;
        startTime = _startTime;
        endTime = _endTime;
        tokenGate = _tokenGate;
        minBalance = _minBalance;
        contractsOnly = _contractsOnly;

        emit PollCreated(_question, _options, _startTime, _endTime, _tokenGate, _minBalance, _contractsOnly);
    }

    // --------------------
    // Modifiers / Helpers
    // --------------------
    modifier onlyDuringVoting() {
        uint64 t = uint64(block.timestamp);
        if (t < startTime) revert PollNotOpen();
        if (t > endTime) revert PollClosed();
        _;
    }

    function _isContract(address a) internal view returns (bool) {
        return a.code.length > 0; // UPs are contracts; EOAs have code.length == 0
    }

    function _eligible(address voter) internal view returns (bool) {
        if (contractsOnly && !_isContract(voter)) {
            return false; // Require contract accounts (e.g., Universal Profiles)
        }
        if (tokenGate != address(0)) {
            uint256 bal = ILSP7DigitalAsset(tokenGate).balanceOf(voter);
            if (bal < minBalance) return false;
        }
        return true;
    }

    // --------------------
    // Voting
    // --------------------
    function vote(uint256 optionIndex) external onlyDuringVoting {
        if (hasVoted[msg.sender]) revert AlreadyVoted();
        if (optionIndex >= options.length) revert InvalidOption();
        if (!_eligible(msg.sender)) revert NotEligible();

        // one address = weight 1 (simple poll)
        hasVoted[msg.sender] = true;
        choiceOf[msg.sender] = optionIndex;
        votes[optionIndex] += 1;

        emit VoteCast(msg.sender, optionIndex, 1);
    }

    // --------------------
    // Views
    // --------------------
    function optionCount() external view returns (uint256) {
        return options.length;
    }

    function hasEnded() public view returns (bool) {
        return uint64(block.timestamp) > endTime;
    }

    function winningOption() external view returns (uint256 index, string memory label, uint256 voteCount) {
        uint256 len = options.length;
        uint256 topIdx;
        uint256 topVotes;
        for (uint256 i = 0; i < len; i++) {
            uint256 v = votes[i];
            if (v > topVotes) {
                topVotes = v;
                topIdx = i;
            }
        }
        return (topIdx, options[topIdx], topVotes);
    }

    function results() external view returns (string[] memory labels, uint256[] memory counts) {
        uint256 len = options.length;
        labels = new string[](len);
        counts = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            labels[i] = options[i];
            counts[i] = votes[i];
        }
    }

    // --------------------
    // Admin-less / immutable: this contract has no owner; parameters are set at deploy.
    // If you need upgradability or admin actions (e.g., cancel poll), wrap the poll in a UP with LSP6 permissions
    // and call through your UP's Key Manager.
    // --------------------
}

/*
How to deploy on LUKSO (testnet or mainnet):
- Use the standard EVM deployment flow (Hardhat/Foundry). LUKSO is EVM-compatible.
- For UP-native UX, call `vote()` from your UP via its Key Manager (controller executes a transaction that results in the UP calling this contract). 
- If you want to enforce UP-only voting strictly, set `contractsOnly = true` at deploy time, which allows contract accounts (like UPs) and excludes EOAs.
- For token-gated polls, set `tokenGate = <LSP7 address>` and `minBalance` accordingly.

Notes:
- This is a minimal poll; for ranked-choice, quadratic voting, or signature-based (ERC-1271) votes, extend with EIP-712 typed data and `isValidSignature` checks.
- Universal Everything can render results by reading `question()`, `options(i)`, `results()` periodically.
*/
