import type {} from "react/jsx-runtime"
import { useState } from "react"
import GameCanvas from "./components/game-canvas"
import { getTeamFlag, MONKEY_COSTS } from "./game/engine"
import type { TeamStats } from "./game/types"
import { MonkeyType } from "./game/types"
import "./App.css"

function App() {
    const debugMode = new URLSearchParams(window.location.search).has("debug")
    const [dominatingTeam, setDominatingTeam] = useState<TeamStats | null>(null)

    // Function to determine dominating team based on various factors
    const getDominatingTeam = (teams: TeamStats[]): TeamStats | null => {
        if (teams.length === 0) return null

        // Filter teams that have alive monkeys
        const teamsWithAliveMonkeys = teams.filter((team) => team.alive > 0)
        if (teamsWithAliveMonkeys.length === 0) return null

        // Prioritize by kills first, then by total SOL, then by alive monkeys
        return teamsWithAliveMonkeys.reduce((dominating, team) => {
            if (team.kills > dominating.kills) return team
            if (team.kills === dominating.kills && team.totalSol > dominating.totalSol) return team
            if (
                team.kills === dominating.kills &&
                team.totalSol === dominating.totalSol &&
                team.alive > dominating.alive
            )
                return team
            return dominating
        })
    }

    return (
        <div className="flex flex-col font-interference">
            <div className="flex flex-col mb-2 p-4">
                <div className="flex flex-col p-4 -ml-64">
                    {dominatingTeam ? (
                        <>
                            <div className="text-2xl text-gray-200">
                                Buy/sell tokens to fund your team • Monkeys spawn every minute
                            </div>
                            <div className="text-2xl mt-2 text-gray-300 flex flex-col items-center">
                                <span>Teams based on Transaction rounded 2nd decimal</span>
                                <span>
                                    (e.g., 0.0<span className="text-lime-400">0932</span> SOL → 0.0
                                    <span className="text-lime-400">1</span> SOL → Team{" "}
                                    <span className="text-lime-400">1</span>)
                                </span>
                            </div>
                            <div className="text-3xl mt-6 text-green-500 flex justify-center items-center gap-3">
                                <span className="text-4xl">{getTeamFlag(dominatingTeam.teamId)}</span>
                                <span>Team {dominatingTeam.teamId} Dominates!</span>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="text-3xl mb-2">$JUNGLE</div>
                            <div className="text-xl text-gray-300">No teams dominating yet...</div>
                        </>
                    )}
                </div>
                <div className="absolute top-6 right-5 p-3 text-white flex flex-col justify-center">
                    <table className="border-collapse text-sm">
                        <tbody>
                            <tr>
                                <td className="py-2 px-4 text-center text-2xl">🐒</td>
                                <td className="py-2 px-4 text-center text-2xl">🐵</td>
                                <td className="py-2 px-4 text-center text-2xl">🦍</td>
                            </tr>
                            <tr>
                                <td className="py-1 px-4 text-center text-sm">Small</td>
                                <td className="py-1 px-4 text-center text-sm">Medium</td>
                                <td className="py-1 px-4 text-center text-sm">Large</td>
                            </tr>
                            <tr>
                                <td className="py-0.5 px-4 text-center text-lime-500 text-base font-bold">
                                    {MONKEY_COSTS[MonkeyType.SMALL]} SOL
                                </td>
                                <td className="py-0.5 px-4 text-center text-lime-500 text-base font-bold">
                                    {MONKEY_COSTS[MonkeyType.MEDIUM]} SOL
                                </td>
                                <td className="py-0.5 px-4 text-center text-lime-500 text-base font-bold">
                                    {MONKEY_COSTS[MonkeyType.BIG]} SOL
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {import.meta.env.VITE_SOLANA_TOKEN || debugMode ? (
                <GameCanvas
                    tokenMint={import.meta.env.VITE_SOLANA_TOKEN}
                    debugMode={debugMode}
                    onTeamStatsUpdate={(teams) => {
                        const dominating = getDominatingTeam(teams)
                        setDominatingTeam(dominating)
                    }}
                />
            ) : (
                <p>
                    Enter a token mint address to start team battles with transactions ≥{" "}
                    {MONKEY_COSTS[MonkeyType.SMALL]} SOL, or add ?debug to the URL for debug mode.
                </p>
            )}
        </div>
    )
}

export default App
