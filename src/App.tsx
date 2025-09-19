import type {} from "react/jsx-runtime"
import GameCanvas from "./components/game-canvas"
import "./App.css"

function App() {
    const debugMode = new URLSearchParams(window.location.search).has("debug")

    return (
        <div className="flex flex-col font-interference">
            <div className="flex flex-col mb-6 p-4">
                <div className="text-2xl mb-2">👑 King of the Jungle</div>
                <div className="text-base">Buy tokens to spawn monkeys. King of jungle gets reward.</div>

                <div className="p-3 text-white flex justify-center">
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
                                <td className="py-0.5 px-4 text-center text-lime-500 text-base font-bold">0.001 SOL</td>
                                <td className="py-0.5 px-4 text-center text-lime-500 text-base font-bold">0.01 SOL</td>
                                <td className="py-0.5 px-4 text-center text-lime-500 text-base font-bold">0.1 SOL</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="text-sm text-gray-500">Selling does not remove your monkeys</div>
            </div>

            {import.meta.env.VITE_SOLANA_TOKEN || debugMode ? (
                <GameCanvas tokenMint={import.meta.env.VITE_SOLANA_TOKEN} debugMode={debugMode} />
            ) : (
                <p>
                    Enter a token mint address to start spawning monkeys from buys ≥ 0.001 SOL, or add ?debug to the URL
                    for debug mode.
                </p>
            )}
        </div>
    )
}

export default App
