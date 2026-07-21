// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPriceAdapter} from "./StandingMandates.sol";

interface IFtsoV2 {
    function getFeedByIdInWei(bytes21 feedId) external payable returns (uint256 value, uint64 timestamp);
}

contract FtsoUsdToFxrpAdapter is IPriceAdapter {
    bytes21 public immutable xrpUsdFeedId = 0x015852502f55534400000000000000000000000000;
    IFtsoV2 public immutable ftso;
    uint256 public immutable fxrpDecimals;

    error InvalidFeed();
    error InvalidResult();

    constructor(address ftsoV2Address, uint8 fxrpDecimals_) {
        if (ftsoV2Address == address(0)) {
            revert InvalidFeed();
        }
        ftso = IFtsoV2(ftsoV2Address);
        fxrpDecimals = fxrpDecimals_;
        if (fxrpDecimals_ > 18) revert InvalidFeed();
    }

    function getFxrpForUsdMicro(uint256 usdMicro) external override returns (uint256 fxrpAmount, uint256 updatedAt) {
        if (usdMicro == 0) return (0, block.timestamp);

        (uint256 xrpUsdUsdWei, uint64 timestamp) = ftso.getFeedByIdInWei{value: 0}(xrpUsdFeedId);
        if (timestamp == 0 || xrpUsdUsdWei == 0) revert InvalidResult();

        uint256 usdAmountAsWei = usdMicro * 1e12; // micro USD -> 18 decimals
        uint256 scale = 10 ** fxrpDecimals;
        fxrpAmount = (usdAmountAsWei * scale) / xrpUsdUsdWei;
        updatedAt = uint256(timestamp);
        if (fxrpAmount == 0) revert InvalidResult();
    }
}
