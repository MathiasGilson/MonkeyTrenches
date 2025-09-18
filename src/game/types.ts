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
    wallet: string
    team: Team
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
}

export type BuyEvent = {
    signature: string
    wallet: string
    lamports: number
    sol: number
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
    wallet: string
    team: Team
    color: string
    spawned: number
    alive: number
    dead: number
    kills: number
    reserves: number
    monkeyType: MonkeyType
}

export type World = {
    monkeys: Monkey[]
    teamStats: Map<string, TeamStats>
    bananas: Banana[]
}

export const SOL_PER_LAMPORT = 1_000_000_000
