import { useEffect, useRef, useState } from "react"
import type { ReactElement } from "react"
import type {} from "react/jsx-runtime"
// import Confetti from "react-confetti" // Removed - no longer needed
import {
    createWorld,
    stepWorld,
    processTransaction,
    spawnMonkeysFromPools,
    getTeamFlag,
    getTeamColor,
    getTeamCountry,
    getTeamIdFromSolAmount,
    MONKEY_COSTS
} from "../game/engine"
import { renderWorld } from "../game/renderer"
import type { GameConfig, Tree, Decoration, World, TeamStats } from "../game/types"
import { MonkeyType } from "../game/types"
import { createPumpPoller } from "../solana/pumpPoller"

export type GameCanvasProps = {
    width?: number
    height?: number
    tokenMint: string
    debugMode?: boolean
    onTeamStatsUpdate?: (teams: TeamStats[]) => void
    customCountries?: Map<string, string>
    customFlags?: Map<string, string>
}

const DEFAULT_WIDTH = 1100
const DEFAULT_HEIGHT = 600
const SPAWN_TIMER_MS = 60 * 1000 // 1 minute

// Transaction and debug constants
const MIN_SOL_FOR_TRANSACTION = MONKEY_COSTS[MonkeyType.SMALL] // Minimum transaction size

const createConfig = (width: number, height: number): GameConfig => {
    // Generate random trees
    const trees: Tree[] = []
    const numTrees = Math.floor((width * height) / 20000) // Density based on map size

    for (let i = 0; i < numTrees; i++) {
        const tree: Tree = {
            position: {
                x: 60 + Math.random() * (width - 120), // Keep trees away from edges
                y: 60 + Math.random() * (height - 120)
            },
            radius: 5 + Math.random() * 3 // Tree collision radius 25-40px
        }

        // Ensure trees don't overlap too much
        let validPosition = true
        for (const existingTree of trees) {
            const dist = Math.hypot(
                tree.position.x - existingTree.position.x,
                tree.position.y - existingTree.position.y
            )
            if (dist < tree.radius + existingTree.radius + 20) {
                validPosition = false
                break
            }
        }

        if (validPosition) {
            trees.push(tree)
        }
    }

    // Generate decorative elements
    const decorations: Decoration[] = []
    const numDecorations = Math.floor((width * height) / 8000) // More decorations than trees

    for (let i = 0; i < numDecorations; i++) {
        const decoration: Decoration = {
            position: {
                x: 30 + Math.random() * (width - 60),
                y: 30 + Math.random() * (height - 60)
            },
            type: Math.random() > 0.6 ? "stone" : "grass", // 40% stones, 60% grass
            size: 16 + Math.random() * 16 // Size between 16-32px
        }

        // Check if decoration overlaps with trees
        let validPosition = true
        for (const tree of trees) {
            const dist = Math.hypot(decoration.position.x - tree.position.x, decoration.position.y - tree.position.y)
            if (dist < tree.radius + 10) {
                validPosition = false
                break
            }
        }

        if (validPosition) {
            decorations.push(decoration)
        }
    }

    return { width, height, maxMonkeys: 2000, trees, decorations }
}

const useAnimationLoop = (callback: (dt: number, now: number) => void): void => {
    const lastRef = useRef<number>(performance.now())
    const intervalRef = useRef<number | null>(null)
    const isHiddenRef = useRef<boolean>(false)

    useEffect(() => {
        const TARGET_FPS = 60
        const FRAME_TIME = 1000 / TARGET_FPS // ~16.67ms for 60fps

        const frame = (): void => {
            const now = performance.now()
            const last = lastRef.current
            const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
            lastRef.current = now
            callback(dt, now)
        }

        // Handle visibility change to maintain game loop when tab is hidden
        const handleVisibilityChange = (): void => {
            isHiddenRef.current = document.hidden
            // Force the game to continue running even when hidden
            if (document.hidden) {
                console.log("🎮 Tab hidden but game continues running for OBS streaming")
            } else {
                console.log("🎮 Tab visible again")
            }
        }

        // Listen for visibility changes
        document.addEventListener("visibilitychange", handleVisibilityChange)

        // Use setInterval with aggressive timing to combat browser throttling
        intervalRef.current = window.setInterval(frame, FRAME_TIME)

        // Also try to maintain a secondary timer for when the main one gets throttled
        const backupIntervalRef = window.setInterval(() => {
            if (isHiddenRef.current) {
                frame() // Force frame update when hidden
            }
        }, FRAME_TIME)

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange)
            if (intervalRef.current !== null) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
            }
            clearInterval(backupIntervalRef)
        }
    }, [callback])
}

const drawDebugStats = (ctx: CanvasRenderingContext2D, world: World): void => {
    ctx.fillStyle = "#ffffff"
    ctx.font = "12px monospace"
    ctx.fillText(`Total Monkeys: ${world.monkeys.length}`, 8, 16)
}

const GameCanvas = ({
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    tokenMint,
    debugMode = false,
    onTeamStatsUpdate,
    customCountries = new Map(),
    customFlags = new Map()
}: GameCanvasProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const worldRef = useRef<World>(createWorld())
    const configRef = useRef<GameConfig>(createConfig(width, height))
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
    const [forceUpdate, setForceUpdate] = useState(0)
    const [resetTimestamp, setResetTimestamp] = useState<number>(0)
    const [lastSpawnTime, setLastSpawnTime] = useState<number>(Date.now())
    const [currentTime, setCurrentTime] = useState<number>(Date.now())
    const [lastTransaction, setLastTransaction] = useState<{
        wallet: string
        sol: number
        teamId: string
        isSell: boolean
        timestamp: number
    } | null>(null)

    // setup canvas context
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        ctxRef.current = ctx
    }, [width, height])

    // Update current time every second for UI countdown
    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentTime(Date.now())
        }, 1000)
        return () => clearInterval(interval)
    }, [])

    // Spawn timer - spawn monkeys every minute based on pool amounts
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now()
            if (now - lastSpawnTime >= SPAWN_TIMER_MS) {
                console.log("⏰ Spawn timer triggered - spawning monkeys from team pools")
                worldRef.current = spawnMonkeysFromPools(worldRef.current, configRef.current)
                setLastSpawnTime(now)
                setForceUpdate((prev) => prev + 1) // Force React re-render for scoreboard
            }
        }, 1000) // Check every second

        return () => clearInterval(interval)
    }, [lastSpawnTime])

    // Transaction poller for buy/sell events
    useEffect(() => {
        if (!tokenMint || debugMode) return
        const poller = createPumpPoller({ tokenMint })
        poller.start((transaction) => {
            if (transaction.sol < MIN_SOL_FOR_TRANSACTION) return

            // Ignore transactions that occurred before the reset timestamp
            if (resetTimestamp > 0 && transaction.ts < resetTimestamp) {
                console.log(`🚫 Ignoring pre-reset transaction from ${new Date(transaction.ts).toLocaleTimeString()}`)
                return
            }

            // Process the transaction and update team pools
            worldRef.current = processTransaction(worldRef.current, transaction)

            // Update last transaction for toast (only for buy transactions)
            if (!transaction.isSell) {
                setLastTransaction({
                    wallet: transaction.wallet,
                    sol: transaction.sol,
                    teamId: transaction.teamId,
                    isSell: transaction.isSell,
                    timestamp: Date.now()
                })
            }

            setForceUpdate((prev) => prev + 1) // Force React re-render for scoreboard
        })
        return () => poller.stop()
    }, [tokenMint, debugMode, resetTimestamp])

    // Reset function to ignore old transactions and clear game state
    const handleReset = (): void => {
        const now = Date.now()
        setResetTimestamp(now)
        setLastSpawnTime(now) // Reset spawn timer
        setLastTransaction(null) // Clear toast

        // Clear the game state
        worldRef.current = createWorld()
        setForceUpdate((prev) => prev + 1) // Force React re-render for scoreboard

        console.log(`🔄 Reset timestamp set to ${new Date(now).toLocaleString()}`)
        console.log("🚫 Future transactions before this time will be ignored")
        console.log("🧹 Game state cleared - all monkeys, teams, and bananas removed")
        console.log(`⏰ Spawn timer reset - next spawn in 1 minute`)
    }

    // Helper function to get next spawn time
    const getNextSpawnTime = (): { remaining: number; nextSpawnAt: number } => {
        const nextSpawnAt = lastSpawnTime + SPAWN_TIMER_MS
        const remaining = Math.max(0, nextSpawnAt - currentTime)
        return { remaining, nextSpawnAt }
    }

    const formatSpawnTimer = (timeMs: number): string => {
        const minutes = Math.floor(timeMs / (1000 * 60))
        const seconds = Math.floor((timeMs % (1000 * 60)) / 1000)
        return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    }

    const getCurrentKing = (): TeamStats | null => {
        const teams = Array.from(worldRef.current.teamStats.values())
        if (teams.length === 0) return null

        // Filter teams that have alive monkeys
        const teamsWithAliveMonkeys = teams.filter((team) => team.alive > 0)
        if (teamsWithAliveMonkeys.length === 0) return null

        // Return the team with most kills among those with alive monkeys
        return teamsWithAliveMonkeys.reduce((king, team) => (team.kills > king.kills ? team : king))
    }

    // Helper functions to get custom or default values
    const getDisplayCountry = (teamId: string): string => {
        return customCountries.get(teamId) || getTeamCountry(teamId)
    }

    const getDisplayFlag = (teamId: string): string => {
        return customFlags.get(teamId) || getTeamFlag(teamId)
    }

    // Debug spawn function
    const spawnRandomMonkeys = (): void => {
        // Generate a SOL amount that will target a specific team
        const targetTeam = Math.floor(Math.random() * 10) // 0-9

        // Generate correct SOL amount for each team based on the rounding logic
        let solAmount: number
        if (targetTeam === 0) {
            solAmount = 0.1 // Rounds to 0.10, second decimal = 0
        } else if (targetTeam === 7) {
            solAmount = 0.17 // Rounds to 0.17, second decimal = 7
        } else {
            solAmount = targetTeam / 100 // 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.09
        }

        // Add minimal randomness while keeping team assignment correct
        const randomOffset = (Math.random() - 0.5) * 0.002 // ±0.001 variation
        solAmount = Math.max(0.001, solAmount + randomOffset)
        solAmount = parseFloat(solAmount.toFixed(3))

        const teamId = getTeamIdFromSolAmount(solAmount)

        const debugTransaction = {
            signature: `debug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            wallet: `debug_wallet_${Math.random().toString(36).slice(2, 8)}`,
            sol: solAmount,
            isSell: false,
            teamId,
            ts: Date.now()
        }

        console.log(`🐵 [DEBUG] Adding ${solAmount.toFixed(3)} SOL to team ${teamId} ${getDisplayFlag(teamId)}`)
        worldRef.current = processTransaction(worldRef.current, debugTransaction)

        // Update last transaction for toast (only for buy transactions)
        if (!debugTransaction.isSell) {
            setLastTransaction({
                wallet: debugTransaction.wallet,
                sol: debugTransaction.sol,
                teamId: debugTransaction.teamId,
                isSell: debugTransaction.isSell,
                timestamp: Date.now()
            })
        }

        setForceUpdate((prev) => prev + 1) // Force React re-render for scoreboard
    }

    // Debug function to remove SOL from random team (simulate sell)
    const removeRandomSol = (): void => {
        // Get teams that have SOL to remove from
        const teamsWithSol = Array.from(worldRef.current.teamPools.entries()).filter(([, pool]) => pool.totalSol > 0)

        if (teamsWithSol.length === 0) {
            console.log(`💸 [DEBUG] No teams with SOL to remove from`)
            return
        }

        // Pick a random team with SOL
        const randomTeamIndex = Math.floor(Math.random() * teamsWithSol.length)
        const [teamId, teamPool] = teamsWithSol[randomTeamIndex]

        // Get a random wallet from this team's funders
        const fundingWallets = Array.from(teamPool.fundingWallets.entries())
        if (fundingWallets.length === 0) {
            console.log(`💸 [DEBUG] Team ${teamId} has no funding wallets`)
            return
        }

        const randomWalletIndex = Math.floor(Math.random() * fundingWallets.length)
        const [wallet, walletContribution] = fundingWallets[randomWalletIndex]

        // Generate a random sell amount (10% to 50% of their contribution)
        const sellPercentage = 0.1 + Math.random() * 0.4 // 10% to 50%
        const sellAmount = Math.min(walletContribution, walletContribution * sellPercentage)
        const roundedSellAmount = parseFloat(sellAmount.toFixed(4))

        const debugTransaction = {
            signature: `debug_sell_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            wallet,
            sol: roundedSellAmount,
            isSell: true,
            teamId,
            ts: Date.now()
        }

        console.log(
            `💸 [DEBUG] Removing ${roundedSellAmount.toFixed(4)} SOL from team ${teamId} ${getDisplayFlag(
                teamId
            )} (wallet: ${wallet.slice(0, 8)}...)`
        )
        worldRef.current = processTransaction(worldRef.current, debugTransaction)

        // Update last transaction for toast (only for buy transactions)
        if (!debugTransaction.isSell) {
            setLastTransaction({
                wallet: debugTransaction.wallet,
                sol: debugTransaction.sol,
                teamId: debugTransaction.teamId,
                isSell: debugTransaction.isSell,
                timestamp: Date.now()
            })
        }

        setForceUpdate((prev) => prev + 1) // Force React re-render for scoreboard
    }

    // game loop
    useAnimationLoop((dt, nowMs) => {
        const ctx = ctxRef.current
        if (!ctx) return
        const now = nowMs
        const oldMonkeyCount = worldRef.current.monkeys.length

        // Fighting is always enabled in the new system
        const fightingEnabled = true

        worldRef.current = stepWorld({
            world: worldRef.current,
            dt,
            now,
            config: configRef.current,
            fightingEnabled
        })
        renderWorld(ctx, worldRef.current, configRef.current, customFlags)
        drawDebugStats(ctx, worldRef.current)

        // Update scoreboard when monkeys die
        if (worldRef.current.monkeys.length !== oldMonkeyCount) {
            setForceUpdate((prev) => prev + 1)
        }
    })

    // Update parent component with team stats whenever they change
    useEffect(() => {
        if (onTeamStatsUpdate) {
            const teams = Array.from(worldRef.current.teamStats.values())
            onTeamStatsUpdate(teams)
        }
    }, [forceUpdate, onTeamStatsUpdate])

    // Auto-hide toast after 5 seconds
    useEffect(() => {
        if (lastTransaction) {
            const timer = setTimeout(() => {
                setLastTransaction(null)
            }, 5000) // Hide after 5 seconds

            return () => clearTimeout(timer)
        }
    }, [lastTransaction])

    const spawnTimer = getNextSpawnTime()

    return (
        <div className="flex flex-col gap-4" style={{ position: "relative" }}>
            {/* CSS Animations */}
            <style>
                {`
                @keyframes glowingTeam {
                    0%, 100% {
                        box-shadow: 
                            0 0 5px rgba(255, 215, 0, 0.3),
                            0 0 10px rgba(255, 215, 0, 0.2);
                    }
                    50% {
                        box-shadow: 
                            0 0 10px rgba(255, 215, 0, 0.6),
                            0 0 20px rgba(255, 215, 0, 0.4);
                    }
                }
                .king-glow {
                    animation: glowingTeam 2s ease-in-out infinite;
                }
                `}
            </style>

            <div className="absolute z-100 -top-8 left-12 flex flex-row items-center justify-center">
                <div className="text-sm font-bold text-green-400">
                    Next spawn: {formatSpawnTimer(spawnTimer.remaining)}
                </div>
            </div>
            <div className="flex w-full gap-4 justify-center">
                <div className="flex flex-col gap-2">
                    {debugMode && (
                        <div className="flex gap-2 items-center">
                            <button
                                onClick={spawnRandomMonkeys}
                                className="px-4 py-2 bg-blue-500 text-white border-none rounded cursor-pointer hover:bg-blue-600"
                            >
                                Add SOL to Random Team
                            </button>
                            <button
                                onClick={removeRandomSol}
                                className="px-4 py-2 bg-orange-500 text-white border-none rounded cursor-pointer hover:bg-orange-600"
                            >
                                Remove SOL from Random Team
                            </button>
                            <button
                                onClick={() => {
                                    worldRef.current = createWorld()
                                    setForceUpdate((prev) => prev + 1) // Force React re-render for scoreboard
                                }}
                                className="px-4 py-2 bg-red-500 text-white border-none rounded cursor-pointer hover:bg-red-600"
                            >
                                Clear All
                            </button>
                        </div>
                    )}

                    <canvas
                        ref={canvasRef}
                        className="border border-gray-900 rounded-lg"
                        style={{
                            width: `${width}px`,
                            height: `${height}px`
                        }}
                    />
                </div>

                {/* Scoreboard */}
                <div className="min-w-[300px] max-w-[400px] p-4 bg-gray-800 rounded-lg text-white">
                    <h3 className="mb-4 text-base">
                        Team Scoreboard{" "}
                        <span onClick={handleReset} className="text-sm inline-block cursor-pointer hover:opacity-80">
                            🔄
                        </span>
                    </h3>

                    <div style={{ maxHeight: height - 100 }} key={forceUpdate}>
                        {(() => {
                            // Create all possible teams 0-9, merging with existing stats
                            const allTeams = []
                            for (let i = 0; i <= 9; i++) {
                                const teamId = i.toString()
                                const existingStats = worldRef.current.teamStats.get(teamId)

                                if (existingStats) {
                                    allTeams.push(existingStats)
                                } else {
                                    // Create placeholder stats for teams without transactions
                                    allTeams.push({
                                        teamId,
                                        color: getTeamColor(teamId),
                                        totalSol: 0,
                                        spawned: 0,
                                        alive: 0,
                                        dead: 0,
                                        kills: 0,
                                        reserves: 0,
                                        monkeyType: MonkeyType.SMALL,
                                        fundingWallets: new Map()
                                    })
                                }
                            }

                            // Sort by activity first (teams with activity on top), then by king status, kills, SOL
                            return allTeams
                                .sort((a, b) => {
                                    const kingTeam = getCurrentKing()?.teamId
                                    const aIsKing = a.teamId === kingTeam
                                    const bIsKing = b.teamId === kingTeam
                                    const aHasActivity = a.totalSol > 0 || a.spawned > 0
                                    const bHasActivity = b.totalSol > 0 || b.spawned > 0

                                    // Teams with activity first
                                    if (aHasActivity && !bHasActivity) return -1
                                    if (!aHasActivity && bHasActivity) return 1

                                    // Within same activity level, sort by king status, kills, SOL
                                    if (aIsKing && !bIsKing) return -1
                                    if (!aIsKing && bIsKing) return 1
                                    if (b.kills !== a.kills) return b.kills - a.kills
                                    if (b.totalSol !== a.totalSol) return b.totalSol - a.totalSol

                                    // Finally sort by team ID for consistent ordering
                                    return parseInt(a.teamId) - parseInt(b.teamId)
                                })
                                .map((stats) => {
                                    const kingTeam = getCurrentKing()?.teamId
                                    const isKing = stats.teamId === kingTeam
                                    const teamPool = worldRef.current.teamPools.get(stats.teamId)
                                    const fundersCount = teamPool?.fundingWallets.size || 0
                                    const hasActivity = stats.totalSol > 0 || stats.spawned > 0

                                    return (
                                        <div
                                            key={stats.teamId}
                                            className={`flex flex-col gap-1 p-3 mb-2 rounded-md relative ${
                                                isKing
                                                    ? "bg-gray-800 border border-yellow-400/30 king-glow"
                                                    : hasActivity
                                                    ? "bg-gray-700"
                                                    : "bg-gray-800/50"
                                            }`}
                                            style={{
                                                borderLeft: `4px solid ${stats.color}`,
                                                opacity: hasActivity ? 1 : 0.6
                                            }}
                                        >
                                            <div className="flex items-center gap-2 text-xs font-bold">
                                                {isKing && <span className="text-sm">👑</span>}
                                                <span className="text-sm">{getDisplayFlag(stats.teamId)}</span>

                                                <span
                                                    className={
                                                        isKing
                                                            ? "text-yellow-400"
                                                            : hasActivity
                                                            ? "text-white"
                                                            : "text-gray-400"
                                                    }
                                                >
                                                    Team {stats.teamId} - {getDisplayCountry(stats.teamId)}
                                                </span>
                                                {!hasActivity && (
                                                    <span className="text-xs text-gray-500 ml-2">
                                                        (waiting for funding)
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-gray-300 text-left">
                                                💰 {stats.totalSol.toFixed(4)} SOL | 👥 {fundersCount} funders
                                            </div>
                                            <div className="text-xs text-gray-300 text-left">
                                                🐵 {stats.alive} | 💀 {stats.dead} | ⚔️ {stats.kills} | 🏦{" "}
                                                {stats.reserves}
                                            </div>
                                        </div>
                                    )
                                })
                        })()}
                    </div>
                </div>
            </div>

            {/* Transaction Toast */}
            {lastTransaction && (
                <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
                    <div
                        className="bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 shadow-lg flex items-center gap-3 animate-pulse"
                        style={{
                            borderLeftColor: getTeamColor(lastTransaction.teamId),
                            borderLeftWidth: "4px"
                        }}
                    >
                        <span className="text-2xl">{getDisplayFlag(lastTransaction.teamId)}</span>
                        <div className="text-white">
                            <span className="font-mono text-sm text-gray-300">
                                {lastTransaction.wallet.slice(0, 5)}...
                            </span>
                            <span className="mx-2">{lastTransaction.isSell ? "💸" : "💰"}</span>
                            <span className="font-bold text-green-400">{lastTransaction.sol.toFixed(3)} SOL</span>
                            <span className="mx-2">→</span>
                            <span className="font-bold text-white">Team {lastTransaction.teamId}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default GameCanvas
