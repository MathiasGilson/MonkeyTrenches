import type { BuyEvent } from "../game/types"

const BASE_URL = "https://public-api.birdeye.so"
const API_KEY = import.meta.env.VITE_BIRDEYE_API_KEY || "4cc73c006df741c988da1a6fbdef8281"

export type PumpPollerConfig = {
    tokenMint: string
    pollIntervalMs?: number
}

export type PumpPoller = {
    start: (onBuy: (buy: BuyEvent) => void) => void
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

const isTokenBuyTransaction = (tx: BirdeyeTransaction, tokenMint: string): boolean => {
    // A buy transaction is when:
    // 1. The side is "buy"
    // 2. The from token is SOL and the to token is our target token
    return tx.side === "buy" && tx.from.address === SOL_MINT && tx.to.address === tokenMint
}

const extractSolSpent = (tx: BirdeyeTransaction): { wallet: string; sol: number } => {
    // Use the uiAmount from the 'from' token (SOL) which is already in human-readable format
    return {
        wallet: tx.owner,
        sol: tx.from.uiAmount
    }
}

export const createPumpPoller = ({ tokenMint, pollIntervalMs = DEFAULT_INTERVAL }: PumpPollerConfig): PumpPoller => {
    let timer: number | undefined
    let running = false
    const history: TransactionHistory = {
        processedTransactions: new Set(),
        lastTimestamp: undefined
    }

    const start = (onBuy: (buy: BuyEvent) => void): void => {
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

                        // Check if this is a token buy transaction (SOL -> Token)
                        if (!isTokenBuyTransaction(tx, tokenMint)) {
                            console.log("⏭️  Skipping non-buy transaction:", tx.txHash)
                            history.processedTransactions.add(tx.txHash)
                            continue
                        }

                        // Extract SOL spent information
                        const solData = extractSolSpent(tx)

                        // Convert to lamports for consistency with existing code
                        const lamports = Math.floor(solData.sol * 1_000_000_000) // SOL_PER_LAMPORT

                        const event: BuyEvent = {
                            signature: tx.txHash,
                            wallet: solData.wallet,
                            lamports,
                            sol: solData.sol,
                            ts: tx.blockUnixTime * 1000 // Convert to milliseconds
                        }

                        console.log("💰 Buy event detected:", {
                            signature: tx.txHash,
                            wallet: solData.wallet.slice(0, 8) + "...",
                            sol: solData.sol.toFixed(4),
                            lamports,
                            targetAmount: tx.to.uiAmount,
                            targetSymbol: tx.to.symbol,
                            source: tx.source,
                            side: tx.side
                        })

                        onBuy(event)
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
