export type Team = string // Now supports infinite teams

export type Vector2 = {
    x: number
    y: number
}

export const MonkeyType = {
    SMALL: "small",
    MEDIUM: "medium",
    BIG: "big"
} as const

export type MonkeyType = (typeof MonkeyType)[keyof typeof MonkeyType]

export type Monkey = {
    id: string
    teamId: string // Team digit (0-9)
    sourceWallet?: string // Optional: wallet that funded this monkey
    monkeyType: MonkeyType
    position: Vector2
    velocity: Vector2
    hp: number
    maxHp: number
    lastAttackAtMs: number
    targetId?: string
    wanderChangeAtMs: number
    isUnderAttack: boolean
    killedBy?: string
    animationFrame: number
    lastAnimationUpdate: number
    isFighting: boolean
    facingLeft: boolean
    collisionRadius: number
    speedMultiplier: number // Random multiplier for walking speed (0.95 - 1.05)
    damageMultiplier: number // Random multiplier for attack damage (0.95 - 1.05)
}

export type BuyEvent = {
    signature: string
    wallet: string
    lamports: number
    sol: number
    ts: number
    isSell?: boolean
}

export type TeamPool = {
    teamId: string // Team digit (0-9)
    totalSol: number
    fundingWallets: Map<string, number> // wallet -> SOL contributed
}

export type TransactionEvent = {
    signature: string
    wallet: string
    sol: number
    isSell: boolean
    teamId: string
    ts: number
}

export type Tree = {
    position: Vector2
    radius: number
}

export type Decoration = {
    position: Vector2
    type: "stone" | "grass"
    size: number
}

export type Banana = {
    id: string
    position: Vector2
    healAmount: number
}

export type GameConfig = {
    width: number
    height: number
    maxMonkeys: number
    trees: Tree[]
    decorations: Decoration[]
}

export type TeamStats = {
    teamId: string // Team digit (0-9)
    color: string
    totalSol: number
    spawned: number
    alive: number
    dead: number
    kills: number
    reserves: number
    monkeyType: MonkeyType
    fundingWallets: Map<string, number> // wallet -> SOL contributed
}

export type WalletContribution = {
    teamId: string
    amount: number
    timestamp: number // For LIFO ordering
}

export type World = {
    monkeys: Monkey[]
    teamStats: Map<string, TeamStats> // teamId -> TeamStats
    teamPools: Map<string, TeamPool> // teamId -> TeamPool
    bananas: Banana[]
    walletContributions: Map<string, WalletContribution[]> // wallet -> contributions (ordered by timestamp)
}

export const SOL_PER_LAMPORT = 1_000_000_000
