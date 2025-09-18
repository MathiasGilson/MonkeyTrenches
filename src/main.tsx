import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import type {} from "react/jsx-runtime"
import "./index.css"
import App from "./App.tsx"

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App />
    </StrictMode>
)
