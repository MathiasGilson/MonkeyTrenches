import type {} from "react/jsx-runtime"
import { useState } from "react"
import GameCanvas from "./components/game-canvas"
import { getTeamCountry, getTeamFlag, MONKEY_COSTS } from "./game/engine"
import type { TeamStats } from "./game/types"
import { MonkeyType } from "./game/types"
import "./App.css"

function App() {
    const debugMode = new URLSearchParams(window.location.search).has("debug")
    const [dominatingTeam, setDominatingTeam] = useState<TeamStats | null>(null)
    const [editingTeam, setEditingTeam] = useState<string | null>(null)
    const [customCountries, setCustomCountries] = useState<Map<string, string>>(new Map())
    const [customFlags, setCustomFlags] = useState<Map<string, string>>(new Map())

    // Helper functions to get custom or default values
    const getDisplayCountry = (teamId: string): string => {
        return customCountries.get(teamId) || getTeamCountry(teamId)
    }

    const getDisplayFlag = (teamId: string): string => {
        return customFlags.get(teamId) || getTeamFlag(teamId)
    }

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
            {/* Team Banner */}
            {/* Team Banner */}
            <div className="w-full py-2 px-4">
                <div className="flex justify-center items-center gap-6 flex-wrap">
                    {Array.from({ length: 10 }, (_, i) => {
                        const teamId = i.toString()

                        return (
                            <div
                                key={teamId}
                                className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-gray-800/50 rounded transition-colors"
                                onClick={() => setEditingTeam(teamId)}
                                title="Click to edit team"
                            >
                                <span className="text-lg">{getDisplayFlag(teamId)}</span>
                                <div className="flex flex-row items-center gap-2 text-gray-500">
                                    <span className="text-sm font-bold">{teamId}</span>
                                    <span className="text-xs">{getDisplayCountry(teamId)}</span>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>

            <div className="flex flex-col mb-4 mt-10 p-4">
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
                                <span className="text-4xl">{getDisplayFlag(dominatingTeam.teamId)}</span>
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
                <div className="absolute top-16 right-5 p-3 text-white flex flex-col justify-center">
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
                    customCountries={customCountries}
                    customFlags={customFlags}
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

            {/* Team Edit Modal */}
            {editingTeam && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 w-96 max-w-full mx-4">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-bold text-white flex items-center gap-3">
                                <span className="text-2xl">{getDisplayFlag(editingTeam)}</span>
                                Edit Team {editingTeam}
                            </h3>
                            <button
                                onClick={() => setEditingTeam(null)}
                                className="text-gray-400 hover:text-white text-xl font-bold"
                            >
                                ×
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Country Name</label>
                                <input
                                    type="text"
                                    value={getDisplayCountry(editingTeam)}
                                    onChange={(e) => {
                                        const newCountries = new Map(customCountries)
                                        if (e.target.value.trim() === "") {
                                            newCountries.delete(editingTeam)
                                        } else {
                                            newCountries.set(editingTeam, e.target.value)
                                        }
                                        setCustomCountries(newCountries)
                                    }}
                                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Enter country name"
                                />
                                <p className="text-xs text-gray-400 mt-1">
                                    Leave empty to use default: {getTeamCountry(editingTeam)}
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Flag Emoji</label>
                                <input
                                    type="text"
                                    value={getDisplayFlag(editingTeam)}
                                    onChange={(e) => {
                                        const newFlags = new Map(customFlags)
                                        if (e.target.value.trim() === "") {
                                            newFlags.delete(editingTeam)
                                        } else {
                                            newFlags.set(editingTeam, e.target.value)
                                        }
                                        setCustomFlags(newFlags)
                                    }}
                                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Enter flag emoji"
                                />
                                <p className="text-xs text-gray-400 mt-1">
                                    Leave empty to use default: {getTeamFlag(editingTeam)}
                                </p>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    onClick={() => {
                                        // Reset to defaults
                                        const newCountries = new Map(customCountries)
                                        const newFlags = new Map(customFlags)
                                        newCountries.delete(editingTeam)
                                        newFlags.delete(editingTeam)
                                        setCustomCountries(newCountries)
                                        setCustomFlags(newFlags)
                                    }}
                                    className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-500 transition-colors"
                                >
                                    Reset to Default
                                </button>
                                <button
                                    onClick={() => setEditingTeam(null)}
                                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors flex-1"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default App
