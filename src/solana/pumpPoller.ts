import type { TransactionEvent } from "../game/types"

const BASE_URL = "https://public-api.birdeye.so"
const API_KEY = import.meta.env.VITE_BIRDEYE_API_KEY || "4cc73c006df741c988da1a6fbdef8281"

export type PumpPollerConfig = {
    tokenMint: string
    pollIntervalMs?: number
}

export type PumpPoller = {
    start: (onTransaction: (transaction: TransactionEvent) => void) => void
    stop: () => void
    isRunning: () => boolean
}

const DEFAULT_INTERVAL = 10000 // 10 seconds for API polling

type TransactionHistory = {
    processedTransactions: Set<string>
    lastTimestamp?: number
}

type BirdeyeTokenInfo = {
    symbol: string
    decimals: number
    address: string
    amount: string
    uiAmount: number
    price: number | null
    nearestPrice?: number
    changeAmount: number
    uiChangeAmount: number
    isScaledUiToken: boolean
    multiplier: number | null
}

type BirdeyeTransaction = {
    quote: BirdeyeTokenInfo
    base: BirdeyeTokenInfo
    basePrice: number | null
    quotePrice: number
    txHash: string
    source: string
    blockUnixTime: number
    txType: string
    owner: string
    side: string
    alias: string | null
    pricePair: number
    from: BirdeyeTokenInfo
    to: BirdeyeTokenInfo
    tokenPrice: number | null
    poolId: string
}

type BirdeyeApiResponse = {
    success: boolean
    data: {
        items: BirdeyeTransaction[]
        hasNextPage: boolean
    }
}

const SOL_MINT = "So11111111111111111111111111111111111111112"

// Pump.fun takes a 1% fee on transactions
const PUMP_FUN_FEE_RATE = 0.01

const fetchTokenTransactions = async (tokenMint: string, offset: number = 0): Promise<BirdeyeApiResponse> => {
    const params = new URLSearchParams({
        address: tokenMint,
        offset: offset.toString(),
        limit: "50",
        tx_type: "swap",
        sort_type: "desc",
        ui_amount_mode: "scaled"
    })

    const url = `${BASE_URL}/defi/txs/token?${params.toString()}`

    const headers: Record<string, string> = {
        accept: "application/json",
        "x-chain": "solana",
        "X-API-KEY": API_KEY
    }

    const response = await fetch(url, { headers })

    if (!response.ok) {
        throw new Error(`Birdeye API error: ${response.status} ${response.statusText}`)
    }

    return await response.json()
}

const isRelevantTransaction = (tx: BirdeyeTransaction, tokenMint: string): { isBuy: boolean; isSell: boolean } => {
    // A buy transaction is when:
    // 1. The side is "buy"
    // 2. The from token is SOL and the to token is our target token
    const isBuy = tx.side === "buy" && tx.from.address === SOL_MINT && tx.to.address === tokenMint

    // A sell transaction is when:
    // 1. The side is "sell"
    // 2. The from token is our target token and the to token is SOL
    const isSell = tx.side === "sell" && tx.from.address === tokenMint && tx.to.address === SOL_MINT

    return { isBuy, isSell }
}

const extractTransactionData = (
    tx: BirdeyeTransaction,
    isBuy: boolean
): { wallet: string; sol: number; originalSol: number } => {
    // For buy transactions: SOL spent (from field) - includes fees
    // For sell transactions: SOL received (to field) - after fees
    const actualSolAmount = isBuy ? tx.from.uiAmount : tx.to.uiAmount

    // Method 1: Use quote/base relationship (more reliable than price calculation)
    let originalSolAmount = actualSolAmount

    if (isBuy) {
        // For buys: Use quote.uiAmount (should be the intended SOL before fees)
        // The quote is usually SOL in SOL->Token swaps
        if (tx.quote && tx.quote.address === SOL_MINT) {
            originalSolAmount = tx.quote.uiAmount
        }
        // Fallback: Add estimated fees back (typically 0.5-2% for DEX trades)
        else {
            const estimatedFeeRate = 0.015 // 1.5% typical fee for pump.fun
            originalSolAmount = actualSolAmount / (1 - estimatedFeeRate)
        }
    } else {
        // For sells: Use quote.uiAmount (should be the expected SOL before fees)
        if (tx.quote && tx.quote.address === SOL_MINT) {
            originalSolAmount = tx.quote.uiAmount
        }
        // Fallback: Add estimated fees back
        else {
            const estimatedFeeRate = 0.015 // 1.5% typical fee for pump.fun
            originalSolAmount = actualSolAmount / (1 - estimatedFeeRate)
        }
    }

    return {
        wallet: tx.owner,
        sol: actualSolAmount, // Keep actual for backward compatibility
        originalSol: originalSolAmount // New field for fee-excluded amount
    }
}

const getTeamIdFromSolAmount = (solAmount: number): string => {
    // Add back the 1% pump.fun fee to get the original intended amount
    // Example: if user received 1 SOL after fees, they originally intended ~1.0101 SOL
    // The fee calculation: originalAmount = receivedAmount / (1 - feeRate)
    const originalIntendedAmount = solAmount / (1 - PUMP_FUN_FEE_RATE)

    // Round up to nearest 0.01 to handle any remaining precision issues
    // Examples:
    // 0.99 SOL (after fee) -> 1.00 SOL (intended) -> team 0
    // 0.0891 SOL (after fee) -> 0.09 SOL (intended) -> team 9
    // 0.0099 SOL (after fee) -> 0.01 SOL (intended) -> team 1
    const roundedAmount = Math.ceil(originalIntendedAmount * 100) / 100
    const secondDecimalDigit = Math.floor((roundedAmount * 100) % 10)

    return secondDecimalDigit.toString()
}

export const createPumpPoller = ({ tokenMint, pollIntervalMs = DEFAULT_INTERVAL }: PumpPollerConfig): PumpPoller => {
    let timer: number | undefined
    let running = false
    const history: TransactionHistory = {
        processedTransactions: new Set(),
        lastTimestamp: undefined
    }

    const start = (onTransaction: (transaction: TransactionEvent) => void): void => {
        if (running) return
        running = true
        console.log("🚀 Starting Birdeye pump poller for token:", tokenMint)

        const tick = async (): Promise<void> => {
            if (!running) return
            try {
                console.log("🔍 Fetching transactions from Birdeye API...")
                const response = await fetchTokenTransactions(tokenMint)

                if (!response.success || !response.data?.items) {
                    console.log("❌ No data received from Birdeye API")
                    return
                }

                console.log(`📋 Found ${response.data.items.length} transactions`)

                // Filter for new transactions we haven't processed yet
                const newTransactions = response.data.items.filter(
                    (tx) => !history.processedTransactions.has(tx.txHash)
                )

                if (newTransactions.length === 0) {
                    console.log("🔄 No new transactions to process")
                } else {
                    console.log(`🆕 Processing ${newTransactions.length} new transactions`)
                }

                // Sort by timestamp (oldest first) to process in chronological order
                newTransactions.sort((a, b) => a.blockUnixTime - b.blockUnixTime)

                for (const tx of newTransactions) {
                    try {
                        console.log("🔍 Processing transaction:", tx)

                        // Check if this is a relevant transaction (buy or sell)
                        const { isBuy, isSell } = isRelevantTransaction(tx, tokenMint)

                        if (!isBuy && !isSell) {
                            console.log("⏭️  Skipping irrelevant transaction:", tx.txHash)
                            history.processedTransactions.add(tx.txHash)
                            continue
                        }

                        // Extract transaction data
                        const transactionData = extractTransactionData(tx, isBuy)
                        // Use actual SOL amount with smart rounding for team assignment
                        const teamId = getTeamIdFromSolAmount(transactionData.sol)
                        // Calculate rounded amount for pool (what user intended to spend)
                        const roundedSol = Math.ceil(transactionData.sol * 100) / 100

                        const event: TransactionEvent = {
                            signature: tx.txHash,
                            wallet: transactionData.wallet,
                            sol: roundedSol, // Use rounded amount for pool calculations
                            isSell: isSell,
                            teamId,
                            ts: tx.blockUnixTime * 1000 // Convert to milliseconds
                        }

                        if (isBuy) {
                            console.log(`💰 BUY`, tx)
                        }
                        console.log(`💰 ${isBuy ? "Buy" : "Sell"} event detected:`, {
                            signature: tx.txHash,
                            wallet: transactionData.wallet.slice(0, 8) + "...",
                            actualSol: transactionData.sol.toFixed(4), // Actual SOL (after fees)
                            roundedSol: roundedSol.toFixed(2), // Rounded amount (what user intended)
                            teamId,
                            side: tx.side,
                            source: tx.source,
                            // Team assignment logic with fee adjustment
                            teamLogic: `${transactionData.sol.toFixed(4)} (after fees) -> ${(
                                transactionData.sol /
                                (1 - PUMP_FUN_FEE_RATE)
                            ).toFixed(4)} (original) -> team ${teamId}`
                        })

                        onTransaction(event)
                    } catch (txError) {
                        console.error("❌ Error processing transaction:", tx.txHash, txError)
                    }

                    // Mark as processed regardless of success/failure
                    history.processedTransactions.add(tx.txHash)
                }

                // Update the last processed timestamp
                if (newTransactions.length > 0) {
                    const latestTimestamp = Math.max(...newTransactions.map((tx) => tx.blockUnixTime))
                    history.lastTimestamp = latestTimestamp
                }
            } catch (err) {
                console.error("💥 Birdeye API error:", err)
            } finally {
                timer = window.setTimeout(() => void tick(), pollIntervalMs)
            }
        }

        void tick()
    }

    const stop = (): void => {
        console.log("🛑 Stopping Birdeye pump poller for token:", tokenMint)
        running = false
        if (timer) window.clearTimeout(timer)
        timer = undefined
    }

    const isRunning = (): boolean => running

    return { start, stop, isRunning }
}
