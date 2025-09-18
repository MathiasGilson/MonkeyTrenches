import type { GameConfig, Monkey, Team, Vector2, World, Banana } from "./types"
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

// Monkey type costs (in SOL)
export const MONKEY_COSTS = {
    [MonkeyType.SMALL]: 0.001,
    [MonkeyType.MEDIUM]: 0.01,
    [MonkeyType.BIG]: 0.1
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

// Spawn multiple monkey types from a single purchase
export const spawnMultipleMonkeyTypes = ({
    world,
    monkeySpawns,
    team,
    wallet,
    at,
    config
}: {
    world: World
    monkeySpawns: Array<{ type: MonkeyType; count: number }>
    team: Team
    wallet: string
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
                team,
                wallet,
                monkeyType: type,
                at,
                config
            })
        }
    }

    return currentWorld
}

export const createWorld = (): World => ({ monkeys: [], teamStats: new Map(), bananas: [] })

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

// Generate team color from wallet hash
export const getTeamColor = (wallet: string): string => {
    let hash = 0
    for (let i = 0; i < wallet.length; i++) {
        hash = (hash * 31 + wallet.charCodeAt(i)) >>> 0
    }

    // Generate HSL color with good saturation and lightness
    const hue = hash % 360
    const saturation = 60 + (hash % 30) // 60-90%
    const lightness = 45 + (hash % 20) // 45-65%

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}

// Each wallet gets its own team (wallet address is the team ID)
export const getTeamForWallet = (wallet: string): Team => wallet

export const spawnMonkeys = ({
    world,
    count,
    team,
    wallet,
    monkeyType,
    at,
    config
}: {
    world: World
    count: number
    team: Team
    wallet: string
    monkeyType: MonkeyType
    at?: Vector2
    config: GameConfig
}): World => {
    if (count <= 0) return world

    const newTeamStats = new Map(world.teamStats)
    const existingStats = newTeamStats.get(wallet)

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
        newTeamStats.set(wallet, {
            wallet,
            team,
            color: getTeamColor(wallet),
            spawned: count,
            alive: monkeysToSpawn,
            dead: 0,
            kills: 0,
            reserves: monkeysToReserve,
            monkeyType
        })
    }

    // Only spawn the monkeys that fit
    if (monkeysToSpawn === 0) {
        console.log(`🏦 All ${count} monkeys for ${wallet.slice(0, 8)}... went to reserves (world full)`)
        return {
            monkeys: world.monkeys,
            teamStats: newTeamStats,
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
        wallet,
        team,
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
        console.log(
            `🐵 Spawned ${monkeysToSpawn} monkeys for ${wallet.slice(0, 8)}..., ${monkeysToReserve} went to reserves`
        )
    } else {
        console.log(`🐵 Spawned ${monkeysToSpawn} monkeys for ${wallet.slice(0, 8)}...`)
    }

    return {
        monkeys: [...world.monkeys, ...newMonkeys],
        teamStats: newTeamStats,
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
    for (const [wallet, stats] of newTeamStats.entries()) {
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
                wallet,
                team: stats.team,
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
            console.log(`🏦 Spawned ${monkeysToSpawn} monkeys from reserves for ${wallet.slice(0, 8)}...`)
        }
    }

    if (newMonkeys.length === 0) return world

    return {
        monkeys: [...world.monkeys, ...newMonkeys],
        teamStats: newTeamStats,
        bananas: world.bananas
    }
}

const findNearestEnemy = (self: Monkey, monkeys: Monkey[]): Monkey | undefined => {
    let nearest: Monkey | undefined
    let bestDist = Infinity
    for (const other of monkeys) {
        if (other.team === self.team) continue
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
        if (other.team !== self.team) continue
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
    config
}: {
    world: World
    dt: number
    now: number
    config: GameConfig
}): World => {
    const monkeys = world.monkeys.map((m) => ({
        ...m,
        isUnderAttack: false,
        collisionRadius: m.collisionRadius ?? BASE_COLLISION_RADIUS // Ensure all monkeys have collision radius
    }))

    const next: Monkey[] = monkeys.map((self) => {
        let desiredVelocity: Vector2 = self.velocity

        const allyInTrouble = findNearestThreatenedAlly(self, monkeys)
        const enemy = allyInTrouble ?? findNearestEnemy(self, monkeys)

        let isFighting = false
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
        } else {
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

    // apply damage
    for (const attacker of next) {
        if (!attacker.targetId) continue
        const victim = next.find((m) => m.id === attacker.targetId)
        if (!victim) continue
        if (victim.team === attacker.team) continue
        const dist = Math.hypot(victim.position.x - attacker.position.x, victim.position.y - attacker.position.y)
        if (dist <= ATTACK_RANGE) {
            const attackerStats = getMonkeyStats(attacker.monkeyType)
            const oldHp = victim.hp
            victim.hp = Math.max(0, victim.hp - attackerStats.damage)
            victim.isUnderAttack = true

            // Track kills when victim dies
            if (oldHp > 0 && victim.hp <= 0) {
                victim.killedBy = attacker.wallet
            }
        }
        attacker.targetId = undefined
    }

    const alive = next.filter((m) => m.hp > 0)
    const dead = next.filter((m) => m.hp <= 0)

    // Update team stats for deaths and kills
    const updatedTeamStats = new Map(world.teamStats)
    for (const deadMonkey of dead) {
        const stats = updatedTeamStats.get(deadMonkey.wallet)
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
    for (const [wallet, stats] of updatedTeamStats.entries()) {
        const currentAlive = alive.filter((m) => m.wallet === wallet).length
        stats.alive = currentAlive
    }

    let worldWithUpdatedStats = { monkeys: alive, teamStats: updatedTeamStats, bananas: world.bananas }

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

export const pickTeamByWallet = (wallet: string): Team => {
    // Each wallet is its own team
    return getTeamForWallet(wallet)
}
