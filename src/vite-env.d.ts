/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_RPC_URL: string
    readonly VITE_SOLANA_TOKEN: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
