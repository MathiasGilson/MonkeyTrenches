import { useEffect, useRef, useState } from "react"
import type { ReactElement } from "react"
import type {} from "react/jsx-runtime"
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
import type { GameConfig, Tree, Decoration, World } from "../game/types"
import { MonkeyType } from "../game/types"
import { createPumpPoller } from "../solana/pumpPoller"

export type GameCanvasProps = {
    width?: number
    height?: number
    tokenMint: string
    debugMode?: boolean
}

const DEFAULT_WIDTH = 960
const DEFAULT_HEIGHT = 540

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

        // Clear the game state
        worldRef.current = createWorld()
        setForceUpdate((prev) => prev + 1) // Force React re-render for scoreboard

        console.log(`🔄 Reset timestamp set to ${new Date(now).toLocaleString()}`)
        console.log("🚫 Future transactions before this time will be ignored")
        console.log("🧹 Game state cleared - all monkeys, teams, and bananas removed")
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
        worldRef.current = stepWorld({ world: worldRef.current, dt, now, config: configRef.current })
        renderWorld(ctx, worldRef.current, configRef.current)
        drawDebugStats(ctx, worldRef.current)

        // Update scoreboard when monkeys die
        if (worldRef.current.monkeys.length !== oldMonkeyCount) {
            setForceUpdate((prev) => prev + 1)
        }
    })

    return (
        <div style={{ display: "flex", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {debugMode && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                            onClick={spawnRandomMonkeys}
                            style={{
                                padding: "8px 16px",
                                backgroundColor: "#3b82f6",
                                color: "white",
                                border: "none",
                                borderRadius: 4,
                                cursor: "pointer"
                            }}
                        >
                            Spawn Random Monkey
                        </button>
                        <button
                            onClick={() => {
                                worldRef.current = createWorld()
                                setForceUpdate((prev) => prev + 1) // Force React re-render for scoreboard
                            }}
                            style={{
                                padding: "8px 16px",
                                backgroundColor: "#ef4444",
                                color: "white",
                                border: "none",
                                borderRadius: 4,
                                cursor: "pointer"
                            }}
                        >
                            Clear All
                        </button>
                        {tokenMint && (
                            <button
                                onClick={handleReset}
                                style={{
                                    padding: "8px 16px",
                                    backgroundColor: "#f59e0b",
                                    color: "white",
                                    border: "none",
                                    borderRadius: 4,
                                    cursor: "pointer"
                                }}
                            >
                                🔄 Reset All
                            </button>
                        )}
                    </div>
                )}
                {!debugMode && tokenMint && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                            onClick={handleReset}
                            style={{
                                padding: "8px 16px",
                                backgroundColor: "#f59e0b",
                                color: "white",
                                border: "none",
                                borderRadius: 4,
                                cursor: "pointer",
                                fontSize: "14px"
                            }}
                        >
                            🔄 Reset Game & Filter
                        </button>
                        {resetTimestamp > 0 && (
                            <span style={{ fontSize: "12px", color: "#6b7280" }}>
                                Ignoring transactions before {new Date(resetTimestamp).toLocaleTimeString()}
                            </span>
                        )}
                    </div>
                )}
                <canvas
                    ref={canvasRef}
                    style={{ width: `${width}px`, height: `${height}px`, border: "1px solid #111827", borderRadius: 8 }}
                />
            </div>

            {/* Scoreboard */}
            <div
                style={{
                    minWidth: 300,
                    maxWidth: 400,
                    padding: 16,
                    backgroundColor: "#1f2937",
                    borderRadius: 8,
                    color: "white"
                }}
            >
                <h3 style={{ margin: "0 0 16px 0", fontSize: 16 }}>Team Scoreboard</h3>
                <div style={{ maxHeight: height - 100, overflowY: "auto" }} key={forceUpdate}>
                    {Array.from(worldRef.current.teamStats.values())
                        .sort((a, b) => b.kills - a.kills)
                        .map((stats) => (
                            <div
                                key={stats.wallet}
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 4,
                                    padding: 12,
                                    marginBottom: 8,
                                    backgroundColor: "#374151",
                                    borderRadius: 6,
                                    borderLeft: `4px solid ${stats.color}`
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        fontSize: 12,
                                        fontWeight: "bold"
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 12,
                                            height: 12,
                                            backgroundColor: stats.color,
                                            borderRadius: "50%"
                                        }}
                                    />
                                    {stats.wallet.slice(0, 12)}...
                                </div>
                                <div style={{ fontSize: 12, color: "#d1d5db", textAlign: "left" }}>
                                    🐵 {stats.alive} | 💀 {stats.dead} | ⚔️ {stats.kills} | 🏦 {stats.reserves}
                                </div>
                            </div>
                        ))}
                    {worldRef.current.teamStats.size === 0 && (
                        <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 32 }}>
                            No teams yet. {debugMode ? "Spawn some monkeys!" : "Waiting for token purchases..."}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default GameCanvas
