// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFlashLoanRecipient} from "./interfaces/IFlashLoanRecipient.sol";
import {IBalancerVault} from "./interfaces/IBalancerVault.sol";

interface IUniV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IUniV2RouterQuote {
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (
            uint256 amountOut,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 gasEstimate
        );
}

struct FlashLoanCallbackParams {
    bool buyOnV2;
    uint256 minProfit;
}

contract ArbitrageExecutor is IFlashLoanRecipient, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint24 public constant V3_FEE = 500;

    IBalancerVault public immutable vault;
    IERC20 public immutable weth;
    IERC20 public immutable usdc;
    IUniV2Router public immutable v2Router;
    ISwapRouter public immutable v3Router;
    IQuoterV2 public immutable v3Quoter;

    event ArbitrageExecuted(uint256 profit);

    constructor(
        address _vault,
        address _weth,
        address _usdc,
        address _v2Router,
        address _v3Router,
        address _v3Quoter
    ) Ownable(msg.sender) {
        vault = IBalancerVault(_vault);
        weth = IERC20(_weth);
        usdc = IERC20(_usdc);
        v2Router = IUniV2Router(_v2Router);
        v3Router = ISwapRouter(_v3Router);
        v3Quoter = IQuoterV2(_v3Quoter);
    }

    function executeArbitrage(
        bool buyOnV2,
        uint256 borrowAmount,
        uint256 minProfit
    ) external onlyOwner {
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = usdc;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = borrowAmount;

        bytes memory userData = abi.encode(
            FlashLoanCallbackParams({buyOnV2: buyOnV2, minProfit: minProfit})
        );

        vault.flashLoan(IFlashLoanRecipient(this), tokens, amounts, userData);
    }

    function receiveFlashLoan(
        IERC20[] memory, /* tokens */
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external override nonReentrant {
        require(msg.sender == address(vault), "Not vault");

        FlashLoanCallbackParams memory p = abi.decode(userData, (FlashLoanCallbackParams));
        uint256 borrowedUsdc = amounts[0];

        uint256 wethOut;
        uint256 finalUsdc;

        if (p.buyOnV2) {
            wethOut = _swapV2(address(usdc), address(weth), borrowedUsdc);
            finalUsdc = _swapV3(address(weth), address(usdc), wethOut);
        } else {
            wethOut = _swapV3(address(usdc), address(weth), borrowedUsdc);
            finalUsdc = _swapV2(address(weth), address(usdc), wethOut);
        }

        uint256 repay = borrowedUsdc + feeAmounts[0];
        require(finalUsdc >= repay + p.minProfit, "Insufficient profit");

        usdc.safeTransfer(address(vault), repay);

        uint256 profit = usdc.balanceOf(address(this));
        usdc.safeTransfer(owner(), profit);

        emit ArbitrageExecuted(profit);
    }

    // Called via eth_call (simulateContract) — nonpayable because QuoterV2 is nonpayable
    function quoteArbitrage(bool buyOnV2, uint256 borrowAmount)
        external
        returns (int256 expectedProfit)
    {
        uint256 wethOut;
        uint256 finalUsdc;

        if (buyOnV2) {
            address[] memory path = new address[](2);
            path[0] = address(usdc);
            path[1] = address(weth);
            uint256[] memory amountsOut = IUniV2RouterQuote(address(v2Router)).getAmountsOut(borrowAmount, path);
            wethOut = amountsOut[1];

            (finalUsdc,,,) = v3Quoter.quoteExactInputSingle(
                IQuoterV2.QuoteExactInputSingleParams({
                    tokenIn: address(weth),
                    tokenOut: address(usdc),
                    amountIn: wethOut,
                    fee: V3_FEE,
                    sqrtPriceLimitX96: 0
                })
            );
        } else {
            (wethOut,,,) = v3Quoter.quoteExactInputSingle(
                IQuoterV2.QuoteExactInputSingleParams({
                    tokenIn: address(usdc),
                    tokenOut: address(weth),
                    amountIn: borrowAmount,
                    fee: V3_FEE,
                    sqrtPriceLimitX96: 0
                })
            );

            address[] memory path = new address[](2);
            path[0] = address(weth);
            path[1] = address(usdc);
            uint256[] memory amountsOut = IUniV2RouterQuote(address(v2Router)).getAmountsOut(wethOut, path);
            finalUsdc = amountsOut[1];
        }

        // USDC amounts always fit in int256 (total supply ~5e19 << 2^255)
        // forge-lint: disable-next-line(unsafe-typecast)
        if (finalUsdc >= borrowAmount) return int256(finalUsdc - borrowAmount);
        // forge-lint: disable-next-line(unsafe-typecast)
        return -int256(borrowAmount - finalUsdc);
    }

    function _swapV2(address tokenIn, address tokenOut, uint256 amountIn)
        internal
        returns (uint256)
    {
        IERC20(tokenIn).forceApprove(address(v2Router), amountIn);
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        uint256[] memory amounts = v2Router.swapExactTokensForTokens(
            amountIn,
            0,
            path,
            address(this),
            block.timestamp
        );
        return amounts[amounts.length - 1];
    }

    function _swapV3(address tokenIn, address tokenOut, uint256 amountIn)
        internal
        returns (uint256)
    {
        IERC20(tokenIn).forceApprove(address(v3Router), amountIn);
        return v3Router.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: V3_FEE,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
    }
}
