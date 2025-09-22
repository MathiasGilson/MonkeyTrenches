import type { GameConfig, Monkey, Vector2, World, Banana, TransactionEvent } from "./types"
import { MonkeyType } from "./types"

// Base monkey stats
const BASE_MONKEY_SIZE = 48
const BASE_COLLISION_RADIUS = 2
const BASE_SPEED = 40 // px per second
const BASE_HP = 100
const BASE_ATTACK_DAMAGE = 12

// Shared constants
const ATTACK_RANGE = 22
const ATTACK_COOLDOWN_MS = 700
const WANDER_INTERVAL_MS = 1250

// Banana constants
const MAX_BANANAS = 5
const BANANA_HEAL_PERCENT = 0.1 // 10% healing
const BANANA_SIZE = 16

// Monkey pricing constants (in SOL)
const SMALL_MONKEY_PRICE = 0.1 // small monkey
const MEDIUM_MONKEY_PRICE = 1 // medium monkey
const BIG_MONKEY_PRICE = 10 // big monkey

// Monkey type costs (in SOL)
export const MONKEY_COSTS = {
    [MonkeyType.SMALL]: SMALL_MONKEY_PRICE,
    [MonkeyType.MEDIUM]: MEDIUM_MONKEY_PRICE,
    [MonkeyType.BIG]: BIG_MONKEY_PRICE
} as const

// Monkey type stats
export type MonkeyStats = {
    size: number
    collisionRadius: number
    speed: number
    maxHp: number
    damage: number
    healthBars: number
}

export const getMonkeyStats = (type: MonkeyType): MonkeyStats => {
    switch (type) {
        case MonkeyType.SMALL:
            return {
                size: BASE_MONKEY_SIZE,
                collisionRadius: BASE_COLLISION_RADIUS,
                speed: BASE_SPEED,
                maxHp: BASE_HP,
                damage: BASE_ATTACK_DAMAGE,
                healthBars: 1
            }
        case MonkeyType.MEDIUM:
            return {
                size: BASE_MONKEY_SIZE * 1.3, // 30% bigger
                collisionRadius: BASE_COLLISION_RADIUS * 1.3,
                speed: BASE_SPEED * 0.5, // 2x slower
                maxHp: BASE_HP * 8, // 8x more HP
                damage: BASE_ATTACK_DAMAGE * 2, // 2x damage
                healthBars: 2
            }
        case MonkeyType.BIG:
            return {
                size: BASE_MONKEY_SIZE * 1.8, // 80% bigger
                collisionRadius: BASE_COLLISION_RADIUS * 1.8,
                speed: BASE_SPEED * 0.33, // 3x slower
                maxHp: BASE_HP * 50, // 50x more HP
                damage: BASE_ATTACK_DAMAGE * 20, // 20x damage
                healthBars: 3
            }
    }
}

// Generate a unique ID for bananas
const generateBananaId = (): string => `banana_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// Spawn a new banana at a random position
const spawnBanana = (config: GameConfig): Banana => {
    const margin = BANANA_SIZE + 10
    return {
        id: generateBananaId(),
        position: {
            x: margin + Math.random() * (config.width - 2 * margin),
            y: margin + Math.random() * (config.height - 2 * margin)
        },
        healAmount: BANANA_HEAL_PERCENT
    }
}

// Add bananas to world if below maximum
const manageBananas = (world: World, config: GameConfig): World => {
    if (world.bananas.length < MAX_BANANAS) {
        const newBanana = spawnBanana(config)
        return {
            ...world,
            bananas: [...world.bananas, newBanana]
        }
    }
    return world
}

// Check if monkey can collect a banana (monkey must be injured)
const canCollectBanana = (monkey: Monkey): boolean => {
    return monkey.hp < monkey.maxHp
}

// Find the nearest banana to an injured monkey
const findNearestBanana = (monkey: Monkey, bananas: Banana[]): Banana | null => {
    if (!canCollectBanana(monkey) || bananas.length === 0) return null

    let nearestBanana: Banana | null = null
    let nearestDistance = Infinity

    for (const banana of bananas) {
        const distance = Math.hypot(monkey.position.x - banana.position.x, monkey.position.y - banana.position.y)
        if (distance < nearestDistance) {
            nearestDistance = distance
            nearestBanana = banana
        }
    }

    return nearestBanana
}

// Collect banana if monkey is close enough and injured
const collectBananas = (world: World): World => {
    const newBananas = [...world.bananas]
    const newMonkeys = world.monkeys.map((monkey) => {
        if (!canCollectBanana(monkey)) return monkey

        // Check if monkey is close to any banana
        for (let i = 0; i < newBananas.length; i++) {
            const banana = newBananas[i]
            const distance = Math.hypot(monkey.position.x - banana.position.x, monkey.position.y - banana.position.y)

            // Collection range is monkey size + banana size
            const stats = getMonkeyStats(monkey.monkeyType)
            const collectionRange = stats.size / 2 + BANANA_SIZE / 2

            if (distance <= collectionRange) {
                // Heal the monkey
                const healAmount = Math.floor(monkey.maxHp * banana.healAmount)
                const newHp = Math.min(monkey.maxHp, monkey.hp + healAmount)

                // Remove the banana
                newBananas.splice(i, 1)

                console.log(`🍌 Monkey healed for ${healAmount} HP (${monkey.hp} → ${newHp})`)

                return {
                    ...monkey,
                    hp: newHp
                }
            }
        }

        return monkey
    })

    return {
        ...world,
        monkeys: newMonkeys,
        bananas: newBananas
    }
}

// Determine monkey types and counts based on SOL amount (greedy allocation starting with biggest)
export const calculateMonkeySpawn = (solAmount: number): Array<{ type: MonkeyType; count: number }> => {
    const ERROR_MARGIN = 0.0001
    const results: Array<{ type: MonkeyType; count: number }> = []

    // Add error margin to account for transaction fees
    let remainingSol = solAmount + ERROR_MARGIN

    // Start with biggest monkeys first (greedy algorithm)
    const monkeyTypes = [MonkeyType.BIG, MonkeyType.MEDIUM, MonkeyType.SMALL] as const

    for (const monkeyType of monkeyTypes) {
        const cost = MONKEY_COSTS[monkeyType]
        const count = Math.floor(remainingSol / cost)

        if (count > 0) {
            results.push({ type: monkeyType, count })
            remainingSol -= count * cost
        }
    }

    return results
}

// Spawn multiple monkey types for a team
export const spawnMultipleMonkeyTypes = ({
    world,
    monkeySpawns,
    teamId,
    at,
    config
}: {
    world: World
    monkeySpawns: Array<{ type: MonkeyType; count: number }>
    teamId: string
    at?: Vector2
    config: GameConfig
}): World => {
    let currentWorld = world

    // Spawn each monkey type sequentially
    for (const { type, count } of monkeySpawns) {
        if (count > 0) {
            currentWorld = spawnMonkeys({
                world: currentWorld,
                count,
                teamId,
                monkeyType: type,
                at,
                config
            })
        }
    }

    return currentWorld
}

export const createWorld = (): World => ({
    monkeys: [],
    teamStats: new Map(),
    teamPools: new Map(),
    bananas: []
})

const clamp = (value: number, min: number, max: number): number => {
    if (value < min) return min
    if (value > max) return max
    return value
}

const randomUnit = (): number => Math.random() * 2 - 1

const randomDir = (): Vector2 => {
    const x = randomUnit()
    const y = randomUnit()
    const len = Math.hypot(x, y) || 1
    return { x: x / len, y: y / len }
}

const normalize = (vector: Vector2): Vector2 => {
    const len = Math.hypot(vector.x, vector.y) || 1
    return { x: vector.x / len, y: vector.y / len }
}

const generateId = (): string => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// Generate team color from team ID (0-9)
export const getTeamColor = (teamId: string): string => {
    const colors = [
        "#DC143C", // Crimson Red - Team 0 (🇺🇸 United States)
        "#0052CC", // Royal Blue - Team 1 (🇫🇷 France)
        "#8B0000", // Dark Red - Team 2 (🇷🇺 Russia)
        "#FF4500", // Orange Red - Team 3 (🇮🇳 India)
        "#FFD700", // Gold Yellow - Team 4 (🇻🇳 Vietnam - star color)
        "#006400", // Dark Green - Team 5 (🇵🇰 Pakistan)
        "#800080", // Purple - Team 6 (🇮🇩 Indonesia - distinct from reds)
        "#1E90FF", // Dodger Blue - Team 7 (🇵🇭 Philippines)
        "#FF1493", // Deep Pink - Team 8 (🇳🇬 Nigeria - more distinct)
        "#00CED1" // Dark Turquoise - Team 9 (🇧🇷 Brazil - unique blue-green)
    ]

    const index = parseInt(teamId) % colors.length
    return colors[index]
}

// Team ID is based on 2nd decimal digit after rounding up
export const getTeamIdFromSolAmount = (solAmount: number): string => {
    // Round up to nearest 0.01 to account for fees, then use 2nd decimal digit
    // Examples:
    // 0.00932 -> 0.01 -> team 1
    // 0.08923 -> 0.09 -> team 9
    // 0.0982 -> 0.10 -> team 0
    // 0.009 -> 0.01 -> team 1 (user intended 0.01 but fees reduced it)

    const roundedAmount = Math.ceil(solAmount * 100) / 100 // Round up to nearest 0.01
    const secondDecimalDigit = Math.floor((roundedAmount * 100) % 10)

    return secondDecimalDigit.toString()
}

// Get flag emoji for team
export const getTeamFlag = (teamId: string): string => {
    const flags = [
        "🇺🇸", // Team 0 - United States
        "🇫🇷", // Team 1 - France
        "🇷🇺", // Team 2 - Russia
        "🇮🇳", // Team 3 - India
        "🇻🇳", // Team 4 - Vietnam
        "🇵🇰", // Team 5 - Pakistan
        "🇮🇩", // Team 6 - Indonesia
        "🇵🇭", // Team 7 - Philippines
        "🇳🇬", // Team 8 - Nigeria
        "🇧🇷" // Team 9 - Brazil
    ]

    const index = parseInt(teamId) % flags.length
    return flags[index]
}

// Process a transaction and update team pools
export const processTransaction = (world: World, transaction: TransactionEvent): World => {
    const newTeamPools = new Map(world.teamPools)
    const newTeamStats = new Map(world.teamStats)

    // Get or create team pool
    let teamPool = newTeamPools.get(transaction.teamId)
    if (!teamPool) {
        teamPool = {
            teamId: transaction.teamId,
            totalSol: 0,
            fundingWallets: new Map()
        }
        newTeamPools.set(transaction.teamId, teamPool)
    }

    // Get or create team stats
    let teamStats = newTeamStats.get(transaction.teamId)
    if (!teamStats) {
        teamStats = {
            teamId: transaction.teamId,
            color: getTeamColor(transaction.teamId),
            totalSol: 0,
            spawned: 0,
            alive: 0,
            dead: 0,
            kills: 0,
            reserves: 0,
            monkeyType: MonkeyType.SMALL,
            fundingWallets: new Map()
        }
        newTeamStats.set(transaction.teamId, teamStats)
    }

    if (transaction.isSell) {
        // Handle sell transaction - remove SOL from pool
        const currentContribution = teamPool.fundingWallets.get(transaction.wallet) || 0

        if (currentContribution > 0) {
            const amountToRemove = Math.min(transaction.sol, currentContribution)

            // Update team pool
            teamPool.totalSol = Math.max(0, teamPool.totalSol - amountToRemove)
            const newContribution = currentContribution - amountToRemove

            if (newContribution <= 0) {
                teamPool.fundingWallets.delete(transaction.wallet)
                teamStats.fundingWallets.delete(transaction.wallet)
            } else {
                teamPool.fundingWallets.set(transaction.wallet, newContribution)
                teamStats.fundingWallets.set(transaction.wallet, newContribution)
            }

            // Update team stats
            teamStats.totalSol = teamPool.totalSol

            console.log(
                `💸 Sell: Team ${transaction.teamId} lost ${amountToRemove.toFixed(4)} SOL (${transaction.wallet.slice(
                    0,
                    8
                )}...). Pool now: ${teamPool.totalSol.toFixed(4)} SOL`
            )
        } else {
            console.log(
                `⚠️ Sell ignored: Wallet ${transaction.wallet.slice(0, 8)}... has no contribution to team ${
                    transaction.teamId
                }`
            )
        }
    } else {
        // Handle buy transaction - add SOL to pool
        const currentContribution = teamPool.fundingWallets.get(transaction.wallet) || 0
        const newContribution = currentContribution + transaction.sol

        // Update team pool
        teamPool.totalSol += transaction.sol
        teamPool.fundingWallets.set(transaction.wallet, newContribution)

        // Update team stats
        teamStats.totalSol = teamPool.totalSol
        teamStats.fundingWallets.set(transaction.wallet, newContribution)

        console.log(
            `💰 Buy: Team ${transaction.teamId} gained ${transaction.sol.toFixed(4)} SOL (${transaction.wallet.slice(
                0,
                8
            )}...). Pool now: ${teamPool.totalSol.toFixed(4)} SOL`
        )
    }

    return {
        ...world,
        teamPools: newTeamPools,
        teamStats: newTeamStats
    }
}

export const spawnMonkeys = ({
    world,
    count,
    teamId,
    monkeyType,
    at,
    config
}: {
    world: World
    count: number
    teamId: string
    monkeyType: MonkeyType
    at?: Vector2
    config: GameConfig
}): World => {
    if (count <= 0) return world

    const newTeamStats = new Map(world.teamStats)
    const existingStats = newTeamStats.get(teamId)

    // Calculate how many can actually spawn vs go to reserves
    const currentMonkeyCount = world.monkeys.length
    const availableSlots = Math.max(0, config.maxMonkeys - currentMonkeyCount)
    const monkeysToSpawn = Math.min(count, availableSlots)
    const monkeysToReserve = count - monkeysToSpawn

    // Update team stats
    if (existingStats) {
        existingStats.spawned += count
        existingStats.alive += monkeysToSpawn
        existingStats.reserves += monkeysToReserve
        // Update monkey type if this is a higher tier purchase
        if (MONKEY_COSTS[monkeyType] > MONKEY_COSTS[existingStats.monkeyType]) {
            existingStats.monkeyType = monkeyType
        }
    } else {
        newTeamStats.set(teamId, {
            teamId,
            color: getTeamColor(teamId),
            totalSol: 0,
            spawned: count,
            alive: monkeysToSpawn,
            dead: 0,
            kills: 0,
            reserves: monkeysToReserve,
            monkeyType,
            fundingWallets: new Map()
        })
    }

    // Only spawn the monkeys that fit
    if (monkeysToSpawn === 0) {
        console.log(`🏦 All ${count} monkeys for team ${teamId} went to reserves (world full)`)
        return {
            monkeys: world.monkeys,
            teamStats: newTeamStats,
            teamPools: world.teamPools,
            bananas: world.bananas
        }
    }

    const spawnPos: Vector2 = at ?? {
        x: Math.random() * (config.width - 100) + 50,
        y: Math.random() * (config.height - 100) + 50
    }

    const stats = getMonkeyStats(monkeyType)
    const newMonkeys: Monkey[] = Array.from({ length: monkeysToSpawn }).map(() => ({
        id: generateId(),
        teamId,
        monkeyType,
        position: {
            x: spawnPos.x + (Math.random() - 0.5) * 40, // Spread spawn slightly
            y: spawnPos.y + (Math.random() - 0.5) * 40
        },
        velocity: randomDir(),
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        lastAttackAtMs: 0,
        targetId: undefined,
        wanderChangeAtMs: 0,
        isUnderAttack: false,
        killedBy: undefined,
        animationFrame: 0,
        lastAnimationUpdate: 0,
        isFighting: false,
        facingLeft: false,
        collisionRadius: stats.collisionRadius
    }))

    if (monkeysToReserve > 0) {
        console.log(`🐵 Spawned ${monkeysToSpawn} monkeys for team ${teamId}, ${monkeysToReserve} went to reserves`)
    } else {
        console.log(`🐵 Spawned ${monkeysToSpawn} monkeys for team ${teamId}`)
    }

    return {
        monkeys: [...world.monkeys, ...newMonkeys],
        teamStats: newTeamStats,
        teamPools: world.teamPools,
        bananas: world.bananas
    }
}

// Spawn monkeys from reserves when there's space
const spawnFromReserves = (world: World, config: GameConfig): World => {
    const newTeamStats = new Map(world.teamStats)
    const newMonkeys: Monkey[] = []

    // Calculate available slots
    const availableSlots = Math.max(0, config.maxMonkeys - world.monkeys.length)
    if (availableSlots === 0) return world

    let slotsUsed = 0

    // Go through teams that have reserves and spawn monkeys
    for (const [teamId, stats] of newTeamStats.entries()) {
        if (stats.reserves === 0 || slotsUsed >= availableSlots) continue

        const monkeysToSpawn = Math.min(stats.reserves, availableSlots - slotsUsed)

        // Create spawn position
        const spawnPos: Vector2 = {
            x: Math.random() * (config.width - 100) + 50,
            y: Math.random() * (config.height - 100) + 50
        }

        // Create monkeys from reserves
        const monkeyStats = getMonkeyStats(stats.monkeyType)
        for (let i = 0; i < monkeysToSpawn; i++) {
            newMonkeys.push({
                id: generateId(),
                teamId,
                monkeyType: stats.monkeyType,
                position: {
                    x: spawnPos.x + (Math.random() - 0.5) * 40,
                    y: spawnPos.y + (Math.random() - 0.5) * 40
                },
                velocity: randomDir(),
                hp: monkeyStats.maxHp,
                maxHp: monkeyStats.maxHp,
                lastAttackAtMs: 0,
                targetId: undefined,
                wanderChangeAtMs: 0,
                isUnderAttack: false,
                killedBy: undefined,
                animationFrame: 0,
                lastAnimationUpdate: 0,
                isFighting: false,
                facingLeft: false,
                collisionRadius: monkeyStats.collisionRadius
            })
        }

        // Update stats
        stats.reserves -= monkeysToSpawn
        stats.alive += monkeysToSpawn
        slotsUsed += monkeysToSpawn

        if (monkeysToSpawn > 0) {
            console.log(`🏦 Spawned ${monkeysToSpawn} monkeys from reserves for team ${teamId}`)
        }
    }

    if (newMonkeys.length === 0) return world

    return {
        monkeys: [...world.monkeys, ...newMonkeys],
        teamStats: newTeamStats,
        teamPools: world.teamPools,
        bananas: world.bananas
    }
}

const findNearestEnemy = (self: Monkey, monkeys: Monkey[]): Monkey | undefined => {
    let nearest: Monkey | undefined
    let bestDist = Infinity
    for (const other of monkeys) {
        if (other.teamId === self.teamId) continue
        const d = Math.hypot(other.position.x - self.position.x, other.position.y - self.position.y)
        if (d < bestDist) {
            bestDist = d
            nearest = other
        }
    }
    return nearest
}

const findNearestThreatenedAlly = (self: Monkey, monkeys: Monkey[]): Monkey | undefined => {
    let nearest: Monkey | undefined
    let bestDist = Infinity
    for (const other of monkeys) {
        if (other.teamId !== self.teamId) continue
        if (!other.isUnderAttack) continue
        const d = Math.hypot(other.position.x - self.position.x, other.position.y - self.position.y)
        if (d < bestDist) {
            bestDist = d
            nearest = other
        }
    }
    return nearest
}

// Check if monkey hit map boundaries
const checkBoundaryCollisions = (
    originalPos: Vector2,
    newPos: Vector2,
    config: GameConfig,
    monkeySize: number
): boolean => {
    const halfSize = monkeySize / 2
    const minX = halfSize
    const maxX = config.width - halfSize
    const minY = halfSize
    const maxY = config.height - halfSize

    // Check if the new position was clamped (hit boundary)
    return (
        (originalPos.x < minX && newPos.x === minX) ||
        (originalPos.x > maxX && newPos.x === maxX) ||
        (originalPos.y < minY && newPos.y === minY) ||
        (originalPos.y > maxY && newPos.y === maxY)
    )
}

// Resolve collision between monkeys by separating them
const resolveMonkeyCollision = (monkey: Monkey, otherMonkeys: Monkey[]): Vector2 => {
    const adjustedPos = { x: monkey.position.x, y: monkey.position.y }

    for (const other of otherMonkeys) {
        if (monkey.id === other.id) continue

        const dx = adjustedPos.x - other.position.x
        const dy = adjustedPos.y - other.position.y
        const distance = Math.hypot(dx, dy)
        const minDistance = monkey.collisionRadius + other.collisionRadius

        if (distance < minDistance && distance > 0) {
            // Calculate separation force
            const separation = minDistance - distance
            const normalX = dx / distance
            const normalY = dy / distance

            // Move monkey away from the collision by half the overlap
            // This prevents monkeys from "sticking" together
            adjustedPos.x += normalX * separation * 0.5
            adjustedPos.y += normalY * separation * 0.5
        }
    }

    return adjustedPos
}

export const stepWorld = ({
    world,
    dt,
    now,
    config,
    fightingEnabled = true
}: {
    world: World
    dt: number
    now: number
    config: GameConfig
    fightingEnabled?: boolean
}): World => {
    const monkeys = world.monkeys.map((m) => ({
        ...m,
        isUnderAttack: false,
        collisionRadius: m.collisionRadius ?? BASE_COLLISION_RADIUS // Ensure all monkeys have collision radius
    }))

    const next: Monkey[] = monkeys.map((self) => {
        let desiredVelocity: Vector2 = self.velocity

        let isFighting = false
        let enemy = null

        if (fightingEnabled) {
            const allyInTrouble = findNearestThreatenedAlly(self, monkeys)
            enemy = allyInTrouble ?? findNearestEnemy(self, monkeys)

            if (enemy) {
                const dist = Math.hypot(enemy.position.x - self.position.x, enemy.position.y - self.position.y)
                if (dist <= ATTACK_RANGE) {
                    desiredVelocity = { x: 0, y: 0 }
                    isFighting = true
                } else {
                    const dir = {
                        x: (enemy.position.x - self.position.x) / (dist || 1),
                        y: (enemy.position.y - self.position.y) / (dist || 1)
                    }
                    desiredVelocity = dir
                }
            }
        }

        if (!enemy) {
            // No enemy found - check if monkey should seek bananas
            const nearestBanana = findNearestBanana(self, world.bananas)
            if (nearestBanana) {
                // Move towards nearest banana
                const dir = normalize({
                    x: nearestBanana.position.x - self.position.x,
                    y: nearestBanana.position.y - self.position.y
                })
                desiredVelocity = dir
            } else {
                // No enemy or banana - wander randomly
                if (now >= self.wanderChangeAtMs || self.isFighting) {
                    // Change direction if time expired OR if was previously fighting (to resume movement)
                    desiredVelocity = randomDir()
                }
            }
        }

        const stats = getMonkeyStats(self.monkeyType)

        const speed = stats.speed
        const proposedPos = {
            x: self.position.x + desiredVelocity.x * speed * dt,
            y: self.position.y + desiredVelocity.y * speed * dt
        }

        let pos = {
            x: clamp(proposedPos.x, stats.size / 2, config.width - stats.size / 2),
            y: clamp(proposedPos.y, stats.size / 2, config.height - stats.size / 2)
        }

        // Check for boundary collision and change direction if not fighting
        const hitBoundary = checkBoundaryCollisions(proposedPos, pos, config, stats.size)

        // If monkey hit boundary while not fighting, change direction randomly
        if (!isFighting && hitBoundary) {
            desiredVelocity = randomDir()
        }

        // Check and resolve monkey-to-monkey collisions
        pos = resolveMonkeyCollision({ ...self, position: pos }, monkeys)

        let lastAttackAtMs = self.lastAttackAtMs
        let targetId = self.targetId

        if (enemy) {
            const dist = Math.hypot(enemy.position.x - pos.x, enemy.position.y - pos.y)
            if (dist <= ATTACK_RANGE && now - lastAttackAtMs >= ATTACK_COOLDOWN_MS) {
                lastAttackAtMs = now
                targetId = enemy.id
            }
        }

        // Update animation and facing direction
        const isMoving = Math.hypot(desiredVelocity.x, desiredVelocity.y) > 0.1
        const animationChanged = self.isFighting !== isFighting
        let animationFrame = self.animationFrame
        let lastAnimationUpdate = self.lastAnimationUpdate

        // Update facing direction based on movement
        let facingLeft = self.facingLeft
        if (isMoving && Math.abs(desiredVelocity.x) > 0.1) {
            facingLeft = desiredVelocity.x < 0
        }

        const ANIMATION_SPEED = 200 // ms per frame
        if (now - lastAnimationUpdate >= ANIMATION_SPEED || animationChanged) {
            if (isFighting) {
                animationFrame = (animationFrame + 1) % 4 // 4 fighting frames
            } else if (isMoving) {
                animationFrame = (animationFrame + 1) % 3 // 3 walking frames
            } else {
                animationFrame = 0 // idle frame
            }
            lastAnimationUpdate = now
        }

        // No automatic health regeneration - monkeys must find bananas to heal
        const newHp = self.hp

        return {
            ...self,
            position: pos,
            velocity: desiredVelocity,
            hp: newHp,
            lastAttackAtMs,
            targetId,
            wanderChangeAtMs: now + WANDER_INTERVAL_MS,
            isFighting,
            animationFrame,
            lastAnimationUpdate,
            facingLeft
        }
    })

    // apply damage (only if fighting is enabled)
    if (fightingEnabled) {
        for (const attacker of next) {
            if (!attacker.targetId) continue
            const victim = next.find((m) => m.id === attacker.targetId)
            if (!victim) continue
            if (victim.teamId === attacker.teamId) continue
            const dist = Math.hypot(victim.position.x - attacker.position.x, victim.position.y - attacker.position.y)
            if (dist <= ATTACK_RANGE) {
                const attackerStats = getMonkeyStats(attacker.monkeyType)
                const oldHp = victim.hp
                victim.hp = Math.max(0, victim.hp - attackerStats.damage)
                victim.isUnderAttack = true

                // Track kills when victim dies
                if (oldHp > 0 && victim.hp <= 0) {
                    victim.killedBy = attacker.teamId
                }
            }
            attacker.targetId = undefined
        }
    } else {
        // Clear all target IDs when fighting is disabled
        for (const attacker of next) {
            attacker.targetId = undefined
        }
    }

    const alive = next.filter((m) => m.hp > 0)
    const dead = next.filter((m) => m.hp <= 0)

    // Update team stats for deaths and kills
    const updatedTeamStats = new Map(world.teamStats)
    for (const deadMonkey of dead) {
        const stats = updatedTeamStats.get(deadMonkey.teamId)
        if (stats) {
            stats.alive = Math.max(0, stats.alive - 1)
            stats.dead += 1
        }

        // Track kills for the killer
        if (deadMonkey.killedBy) {
            const killerStats = updatedTeamStats.get(deadMonkey.killedBy)
            if (killerStats) {
                killerStats.kills += 1
            }
        }
    }

    // Update alive counts based on current monkeys
    for (const [teamId, stats] of updatedTeamStats.entries()) {
        const currentAlive = alive.filter((m) => m.teamId === teamId).length
        stats.alive = currentAlive
    }

    let worldWithUpdatedStats = {
        monkeys: alive,
        teamStats: updatedTeamStats,
        teamPools: world.teamPools,
        bananas: world.bananas
    }

    // Spawn from reserves if monkeys died and there's space
    if (dead.length > 0) {
        worldWithUpdatedStats = spawnFromReserves(worldWithUpdatedStats, config)
    }

    // Handle banana collection
    worldWithUpdatedStats = collectBananas(worldWithUpdatedStats)

    // Manage banana spawning
    worldWithUpdatedStats = manageBananas(worldWithUpdatedStats, config)

    return worldWithUpdatedStats
}

// Spawn monkeys based on team pool amounts - called by timer
export const spawnMonkeysFromPools = (world: World, config: GameConfig): World => {
    let updatedWorld = world

    // Process each team pool
    for (const [teamId, pool] of world.teamPools.entries()) {
        if (pool.totalSol > 0) {
            const monkeySpawns = calculateMonkeySpawn(pool.totalSol)

            // Spawn each monkey type sequentially
            for (const { type, count } of monkeySpawns) {
                if (count > 0) {
                    updatedWorld = spawnMonkeys({
                        world: updatedWorld,
                        count,
                        teamId,
                        monkeyType: type,
                        config
                    })
                }
            }

            console.log(`⏰ Timer spawn: Team ${teamId} spawned monkeys based on ${pool.totalSol.toFixed(4)} SOL pool`)
        }
    }

    return updatedWorld
}
