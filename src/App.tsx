import type {} from "react/jsx-runtime"
import GameCanvas from "./components/game-canvas"
import "./App.css"

function App() {
    const debugMode = new URLSearchParams(window.location.search).has("debug")

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
            <h1 style={{ marginTop: 0, marginBottom: 0 }}>Monkey Trenches</h1>
            <h2 style={{ marginTop: 0, marginBottom: 0 }}>Each buy of 0.001 SOL will spawn a monkey for your team</h2>
            <h2 style={{ marginTop: 0, marginBottom: 0 }}>your monkey will fight other monkeys to death</h2>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Selling does not remove your monkeys</h2>

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
