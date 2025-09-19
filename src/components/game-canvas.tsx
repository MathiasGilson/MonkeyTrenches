import { useEffect, useRef, useState } from "react"
import type { ReactElement } from "react"
import type {} from "react/jsx-runtime"
import Confetti from "react-confetti"
import {
    createWorld,
    pickTeamByWallet,
    spawnMonkeys,
    stepWorld,
    calculateMonkeySpawn,
    spawnMultipleMonkeyTypes,
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
}

const DEFAULT_WIDTH = 1100
const DEFAULT_HEIGHT = 600
const REWARD_SOL = 5 // SOL reward for the king when countdown ends

const MIN_SOL_FOR_SPAWN = MONKEY_COSTS[MonkeyType.SMALL] // 0.001 SOL

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
    ctx.fillText(`Active Teams: ${world.teamStats.size}`, 8, 32)
}

const GameCanvas = ({
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    tokenMint,
    debugMode = false
}: GameCanvasProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const worldRef = useRef<World>(createWorld())
    const configRef = useRef<GameConfig>(createConfig(width, height))
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
    const [forceUpdate, setForceUpdate] = useState(0)
    const [resetTimestamp, setResetTimestamp] = useState<number>(0)
    const [countdownStartTime, setCountdownStartTime] = useState<number>(Date.now())
    const [currentTime, setCurrentTime] = useState<number>(Date.now())
    const [currentKingWallet, setCurrentKingWallet] = useState<string | null>(null)
    const [showConfetti, setShowConfetti] = useState<boolean>(false)
    const [winner, setWinner] = useState<TeamStats | null>(null)
    const [showWinnerModal, setShowWinnerModal] = useState<boolean>(false)
    const [countdownActive, setCountdownActive] = useState<boolean>(false)

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

    // Countdown timer
    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentTime(Date.now())
        }, 1000)
        return () => clearInterval(interval)
    }, [])

    // Monitor king changes and manage countdown
    useEffect(() => {
        const king = getCurrentKing()
        const newKingWallet = king?.wallet || null
        const hasKingWithKills = king !== null && king.kills > 0

        // Check if we should start/stop the countdown
        if (hasKingWithKills && !countdownActive) {
            // Start countdown - first king with kills
            const now = Date.now()
            setCountdownStartTime(now)
            setCountdownActive(true)
            console.log(`👑 First king detected: ${newKingWallet?.slice(0, 8)}... - Countdown started!`)
        } else if (hasKingWithKills && countdownActive && currentKingWallet !== newKingWallet) {
            // Reset countdown - new king
            const now = Date.now()
            setCountdownStartTime(now)
            console.log(`👑 New king detected: ${newKingWallet?.slice(0, 8)}... - Countdown reset!`)
        } else if (!hasKingWithKills && countdownActive) {
            // Stop countdown - no king with kills
            setCountdownActive(false)
            console.log(`⏹️ No king with kills - Countdown stopped`)
        }

        setCurrentKingWallet(newKingWallet)
    }, [forceUpdate, currentKingWallet, debugMode, countdownActive])

    // Handle countdown expiration and confetti
    useEffect(() => {
        if (!countdownActive) return

        const COUNTDOWN_DURATION = debugMode
            ? 30 * 1000 // 30 seconds in debug mode
            : 2 * 60 * 60 * 1000 // 2 hours in normal mode
        const elapsed = currentTime - countdownStartTime
        const remaining = Math.max(0, COUNTDOWN_DURATION - elapsed)
        const isExpired = remaining === 0

        if (isExpired && !showConfetti && currentKingWallet) {
            const currentKing = getCurrentKing()
            if (currentKing) {
                setWinner(currentKing)
                setShowWinnerModal(true)
                setShowConfetti(true)
                setCountdownActive(false) // Stop countdown after win
                console.log(`🎉 Countdown ended! King ${currentKingWallet.slice(0, 8)}... wins ${REWARD_SOL} SOL!`)
                // Confetti will run until modal is closed
            }
        }
    }, [currentTime, showConfetti, currentKingWallet, countdownStartTime, debugMode, countdownActive])

    // Jupiter API poller for buy events
    useEffect(() => {
        if (!tokenMint || debugMode) return
        const poller = createPumpPoller({ tokenMint })
        poller.start((buy) => {
            if (buy.sol < MIN_SOL_FOR_SPAWN) return

            // Ignore transactions that occurred before the reset timestamp
            if (resetTimestamp > 0 && buy.ts < resetTimestamp) {
                console.log(`🚫 Ignoring pre-reset transaction from ${new Date(buy.ts).toLocaleTimeString()}`)
                return
            }

            const monkeySpawns = calculateMonkeySpawn(buy.sol)
            const team = pickTeamByWallet(buy.wallet)

            const oldMonkeyCount = worldRef.current.monkeys.length
            console.log(`🐵 Before spawn: ${oldMonkeyCount} monkeys`)

            // Log what types are being spawned
            const spawnSummary = monkeySpawns.map(({ type, count }) => `${count} ${type}`).join(", ")
            console.log(`🔥 Spawning ${spawnSummary} monkeys for wallet ${buy.wallet.slice(0, 8)}... (${buy.sol} SOL)`)

            worldRef.current = spawnMultipleMonkeyTypes({
                world: worldRef.current,
                monkeySpawns,
                team,
                wallet: buy.wallet,
                config: configRef.current
            })

            const newMonkeyCount = worldRef.current.monkeys.length
            console.log(`🎯 After spawn: ${newMonkeyCount} monkeys (added ${newMonkeyCount - oldMonkeyCount})`)

            setForceUpdate((prev) => prev + 1) // Force React re-render for scoreboard
        })
        return () => poller.stop()
    }, [tokenMint, debugMode, resetTimestamp])

    // Reset function to ignore old transactions and clear game state
    const handleReset = (): void => {
        const now = Date.now()
        setResetTimestamp(now)
        setCountdownStartTime(now) // Reset countdown timer
        setCurrentKingWallet(null) // Reset king tracking
        setShowConfetti(false) // Hide confetti
        setShowWinnerModal(false) // Hide winner modal
        setWinner(null) // Clear winner
        setCountdownActive(false) // Stop countdown

        // Clear the game state
        worldRef.current = createWorld()
        setForceUpdate((prev) => prev + 1) // Force React re-render for scoreboard

        console.log(`🔄 Reset timestamp set to ${new Date(now).toLocaleString()}`)
        console.log("🚫 Future transactions before this time will be ignored")
        console.log("🧹 Game state cleared - all monkeys, teams, and bananas removed")
        console.log(`⏰ Countdown will start when first king appears`)
    }

    // Helper functions for countdown and king
    const formatCountdown = (timeMs: number): string => {
        const hours = Math.floor(timeMs / (1000 * 60 * 60))
        const minutes = Math.floor((timeMs % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((timeMs % (1000 * 60)) / 1000)
        return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
            .toString()
            .padStart(2, "0")}`
    }

    const getCountdownTime = (): { remaining: number; isExpired: boolean } => {
        const COUNTDOWN_DURATION = debugMode
            ? 30 * 1000 // 30 seconds in debug mode
            : 2 * 60 * 60 * 1000 // 2 hours in normal mode

        if (!countdownActive) {
            return { remaining: COUNTDOWN_DURATION, isExpired: false }
        }

        const elapsed = currentTime - countdownStartTime
        const remaining = Math.max(0, COUNTDOWN_DURATION - elapsed)
        return { remaining, isExpired: remaining === 0 }
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

    // Debug spawn function
    const spawnRandomMonkeys = (): void => {
        const count = 1 // Only one monkey at a time

        // Randomly choose monkey type for debug
        const monkeyTypes = [MonkeyType.SMALL, MonkeyType.MEDIUM, MonkeyType.BIG]
        const monkeyType = monkeyTypes[Math.floor(Math.random() * monkeyTypes.length)]

        // 50% chance to use existing team if teams exist, otherwise create new
        const existingTeams = Array.from(worldRef.current.teamStats.keys())
        const useExistingTeam = existingTeams.length > 0 && Math.random() > 0.5

        let wallet: string
        if (useExistingTeam) {
            // Pick random existing team
            wallet = existingTeams[Math.floor(Math.random() * existingTeams.length)]
        } else {
            // Create new team
            wallet = `debug_${Math.random().toString(36).slice(2, 8)}_${Date.now()}`
        }

        const team = pickTeamByWallet(wallet)
        const at = {
            x: Math.random() * (configRef.current.width - 100) + 50,
            y: Math.random() * (configRef.current.height - 100) + 50
        }

        const oldMonkeyCount = worldRef.current.monkeys.length
        console.log(`🐵 [DEBUG] Before spawn: ${oldMonkeyCount} monkeys`)

        worldRef.current = spawnMonkeys({
            world: worldRef.current,
            count,
            team,
            wallet,
            monkeyType,
            at,
            config: configRef.current
        })

        const newMonkeyCount = worldRef.current.monkeys.length
        console.log(
            `🎯 [DEBUG] After spawn: ${newMonkeyCount} ${monkeyType} monkeys (added ${newMonkeyCount - oldMonkeyCount})`
        )

        setForceUpdate((prev) => prev + 1) // Force React re-render for scoreboard
    }

    // game loop
    useAnimationLoop((dt, nowMs) => {
        const ctx = ctxRef.current
        if (!ctx) return
        const now = nowMs
        const oldMonkeyCount = worldRef.current.monkeys.length

        // Check if fighting should be enabled (not expired and countdown is active)
        const countdown = getCountdownTime()
        const fightingEnabled = !countdown.isExpired

        worldRef.current = stepWorld({
            world: worldRef.current,
            dt,
            now,
            config: configRef.current,
            fightingEnabled
        })
        renderWorld(ctx, worldRef.current, configRef.current)
        drawDebugStats(ctx, worldRef.current)

        // Update scoreboard when monkeys die
        if (worldRef.current.monkeys.length !== oldMonkeyCount) {
            setForceUpdate((prev) => prev + 1)
        }
    })

    const countdown = getCountdownTime()

    return (
        <div className="flex flex-col gap-4" style={{ position: "relative" }}>
            {/* CSS Animations */}
            <style>
                {`
                @keyframes waveGoldGradient {
                    0% {
                        background-position: -200% center;
                    }
                    100% {
                        background-position: 200% center;
                    }
                }
                .wave-gold-text {
                    background: linear-gradient(
                        90deg,
                        #fbbf24 0%,
                        #f59e0b 25%,
                        #fcd34d 50%,
                        #f59e0b 75%,
                        #fbbf24 100%
                    );
                    background-size: 200% 100%;
                    background-clip: text;
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    animation: waveGoldGradient 3s ease-in-out infinite;
                }
                @keyframes glowingGold {
                    0%, 100% {
                        box-shadow: 
                            0 0 5px rgba(255, 215, 0, 0.3),
                            0 0 10px rgba(255, 215, 0, 0.2),
                            0 0 15px rgba(255, 215, 0, 0.1),
                            0 0 20px rgba(255, 215, 0, 0.1);
                    }
                    50% {
                        box-shadow: 
                            0 0 10px rgba(255, 215, 0, 0.6),
                            0 0 20px rgba(255, 215, 0, 0.4),
                            0 0 30px rgba(255, 215, 0, 0.3),
                            0 0 40px rgba(255, 215, 0, 0.2);
                    }
                }
                .king-glow {
                    animation: glowingGold 2s ease-in-out infinite;
                }
                `}
            </style>

            {/* React Confetti */}
            {showConfetti && (
                <div className="fixed inset-0 pointer-events-none z-[3000]">
                    <Confetti
                        width={window.innerWidth}
                        height={window.innerHeight}
                        recycle={true}
                        numberOfPieces={200}
                        gravity={0.3}
                    />
                </div>
            )}

            {/* Winner Modal */}
            {showWinnerModal && winner && (
                <div
                    className="fixed inset-0 bg-black/80 z-[2000] flex items-center justify-center"
                    onClick={handleReset}
                >
                    <div
                        className="bg-gray-800 p-8 rounded-2xl border-2 border-yellow-400 text-center text-white min-w-[400px]"
                        style={{ boxShadow: "0 0 40px rgba(255, 215, 0, 0.5)" }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="text-5xl mb-4">👑</div>
                        <h2 className="text-3xl text-yellow-400 mb-4 font-bold">VICTORY!</h2>
                        <div className="text-xl mb-6 flex items-center justify-center gap-3">
                            <div className="w-6 h-6 rounded-full" style={{ backgroundColor: winner.color }} />
                            <span className="font-mono">{winner.wallet.slice(0, 16)}...</span>
                        </div>
                        <div className="text-base mb-6 text-gray-300 space-y-1">
                            <div>
                                🐵 Alive: {winner.alive} | 💀 Dead: {winner.dead}
                            </div>
                            <div>
                                ⚔️ Kills: {winner.kills} | 🏦 Reserves: {winner.reserves}
                            </div>
                        </div>
                        <div className="text-2xl text-yellow-400 font-bold mb-4">🏆 Reward: {REWARD_SOL} SOL 🏆</div>
                        <button
                            onClick={handleReset}
                            className="px-6 py-3 bg-yellow-400 text-black border-none rounded-lg text-base font-bold cursor-pointer hover:bg-yellow-500 transition-colors"
                        >
                            Start New Battle
                        </button>
                    </div>
                </div>
            )}

            <div className="flex flex-row gap-2 items-center justify-center mb-6 -ml-64">
                <div className="text-4xl font-bold wave-gold-text">{REWARD_SOL} SOL Reward</div>
                {countdownActive ? (
                    <>
                        <div className="text-4xl font-bold">to the King in</div>
                        <div
                            className={`text-4xl font-mono ${countdown.isExpired ? "text-red-500" : "text-green-400"}`}
                        >
                            {countdown.isExpired ? "BATTLE ENDED!" : formatCountdown(countdown.remaining)}
                        </div>
                    </>
                ) : (
                    <div className="text-4xl font-bold text-gray-400">awaiting first king...</div>
                )}
            </div>
            <div className="flex w-full gap-4 justify-center">
                <div className="flex flex-col gap-2">
                    {debugMode && (
                        <div className="flex gap-2 items-center">
                            <button
                                onClick={spawnRandomMonkeys}
                                className="px-4 py-2 bg-blue-500 text-white border-none rounded cursor-pointer hover:bg-blue-600"
                            >
                                Spawn Random Monkey
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
                        {Array.from(worldRef.current.teamStats.values())
                            .sort((a, b) => b.kills - a.kills)
                            .map((stats, index) => {
                                const isKing = index === 0
                                return (
                                    <div
                                        key={stats.wallet}
                                        className={`flex flex-col gap-1 p-3 mb-2 rounded-md relative ${
                                            isKing ? "bg-gray-800 border border-yellow-400/30 king-glow" : "bg-gray-700"
                                        }`}
                                        style={{
                                            borderLeft: `4px solid ${stats.color}`
                                        }}
                                    >
                                        <div className="flex items-center gap-2 text-xs font-bold">
                                            {isKing && <span className="text-sm">👑</span>}
                                            <div
                                                className="w-3 h-3 rounded-full"
                                                style={{ backgroundColor: stats.color }}
                                            />
                                            <span className={isKing ? "text-yellow-400" : "text-white"}>
                                                {stats.wallet.slice(0, 12)}...
                                            </span>
                                        </div>
                                        <div className="text-xs text-gray-300 text-left">
                                            🐵 {stats.alive} | 💀 {stats.dead} | ⚔️ {stats.kills} | 🏦 {stats.reserves}
                                        </div>
                                    </div>
                                )
                            })}
                        {worldRef.current.teamStats.size === 0 && (
                            <div className="text-xs text-gray-400 text-center mt-8">
                                No teams yet. {debugMode ? "Spawn some monkeys!" : "Waiting for token purchases..."}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default GameCanvas
