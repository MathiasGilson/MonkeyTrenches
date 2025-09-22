import type { GameConfig, Monkey, Tree, Decoration, World, Banana } from "./types"
import { getTeamFlag, getMonkeyStats } from "./engine"

// Type for depth-sorted rendering objects
type RenderObject = {
    type: "tree" | "monkey" | "banana"
    y: number
    data: Tree | Monkey | Banana
}

const MONKEY_COLOR = "#8b5a2b"
const OUTLINE = "#111827"

// Sprite cache
const spriteCache = new Map<string, HTMLImageElement>()

// Load tree sprite
const treeSprite = (() => {
    const img = new Image()
    img.src = `${import.meta.env.BASE_URL}tree.png`
    return img
})()

// Load decorative sprites
const stoneSprite = (() => {
    const img = new Image()
    img.src = `${import.meta.env.BASE_URL}stone.png`
    return img
})()

const grassSprite = (() => {
    const img = new Image()
    img.src = `${import.meta.env.BASE_URL}grass.png`
    return img
})()

// Load banana sprite
const bananaSprite = (() => {
    const img = new Image()
    img.src = `${import.meta.env.BASE_URL}banana.png`
    return img
})()

// Background canvas cache
let backgroundCanvas: HTMLCanvasElement | null = null
let backgroundGenerated = false

const loadSprite = (src: string): HTMLImageElement => {
    if (spriteCache.has(src)) {
        return spriteCache.get(src)!
    }

    const img = new Image()
    img.src = `${import.meta.env.BASE_URL}${src}`
    spriteCache.set(src, img)
    return img
}

// Load all sprites
const walkSprites = [loadSprite("walk1.png"), loadSprite("walk2.png"), loadSprite("walk3.png")]

const fightSprites = [
    loadSprite("fight1.png"),
    loadSprite("fight2.png"),
    loadSprite("fight3.png"),
    loadSprite("fight4.png")
]

const drawRoundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
): void => {
    const rr = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + w, y, x + w, y + h, rr)
    ctx.arcTo(x + w, y + h, x, y + h, rr)
    ctx.arcTo(x, y + h, x, y, rr)
    ctx.arcTo(x, y, x + w, y, rr)
    ctx.closePath()
}

const drawMonkey = (ctx: CanvasRenderingContext2D, m: Monkey): void => {
    const stats = getMonkeyStats(m.monkeyType)
    const size = stats.size
    const x = m.position.x - size / 2
    const y = m.position.y - size / 2

    // Get the appropriate sprite
    let sprite: HTMLImageElement
    if (m.isFighting) {
        sprite = fightSprites[m.animationFrame] || fightSprites[0]
    } else {
        sprite = walkSprites[m.animationFrame] || walkSprites[0]
    }

    // Draw sprite if loaded
    if (sprite.complete && sprite.naturalWidth > 0) {
        ctx.save()

        // Flip sprite horizontally if facing left
        if (m.facingLeft) {
            ctx.scale(-1, 1)
            ctx.drawImage(sprite, -x - size, y, size, size)
        } else {
            ctx.drawImage(sprite, x, y, size, size)
        }

        ctx.restore()
    } else {
        // Fallback to simple rectangle if sprite not loaded
        ctx.fillStyle = MONKEY_COLOR
        ctx.strokeStyle = OUTLINE
        drawRoundedRect(ctx, x, y, size, size, 4)
        ctx.fill()
        ctx.stroke()
    }

    // Team flag above health bar
    const flagSize = Math.max(12, size * 0.25) // Scale flag with monkey size
    const flagY = y - 15 - flagSize / 2 // Position above health bar

    // Draw flag emoji
    ctx.font = `${flagSize}px Arial`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(getTeamFlag(m.teamId), m.position.x, flagY + flagSize / 2)

    // Multi-bar health system (horizontal layout)
    const totalBars = stats.healthBars
    const barHeight = 4
    const separatorWidth = 1 // Black pixel separator between bars
    const totalSeparatorWidth = (totalBars - 1) * separatorWidth
    const totalBarWidth = size - totalSeparatorWidth
    const individualBarWidth = totalBarWidth / totalBars
    const hpPerBar = m.maxHp / totalBars
    const currentHp = m.hp
    const barY = y - 7

    for (let i = 0; i < totalBars; i++) {
        // Calculate position for horizontal layout
        const barX = x + i * (individualBarWidth + separatorWidth)

        // For rightmost-first depletion, the rightmost bar should represent the highest HP range
        // Bar 0 (leftmost) = lowest HP range, Bar n-1 (rightmost) = highest HP range
        const barStartHp = i * hpPerBar

        // Calculate how much of this bar should be filled
        let barFillRatio = 0
        if (currentHp > barStartHp) {
            const hpInThisBar = Math.min(currentHp - barStartHp, hpPerBar)
            barFillRatio = hpInThisBar / hpPerBar
        }

        // Draw bar background (dark)
        ctx.fillStyle = "#1f2937"
        drawRoundedRect(ctx, barX, barY, individualBarWidth, barHeight, 2)
        ctx.fill()

        // Draw separator line between bars (black pixel line)
        if (i > 0) {
            ctx.fillStyle = "#000000"
            ctx.fillRect(barX - separatorWidth, barY, separatorWidth, barHeight)
        }

        // Draw filled portion
        if (barFillRatio > 0) {
            ctx.fillStyle = barFillRatio > 0.5 ? "#10b981" : barFillRatio > 0.25 ? "#f59e0b" : "#ef4444"
            drawRoundedRect(ctx, barX, barY, individualBarWidth * barFillRatio, barHeight, 2)
            ctx.fill()
        }
    }
}

const drawBanana = (ctx: CanvasRenderingContext2D, banana: Banana): void => {
    const size = 16
    const x = banana.position.x - size / 2
    const y = banana.position.y - size / 2

    // Draw sprite if loaded
    if (bananaSprite.complete && bananaSprite.naturalWidth > 0) {
        ctx.drawImage(bananaSprite, x, y, size, size)
    } else {
        // Fallback to simple banana shape if sprite not loaded
        ctx.fillStyle = "#FFD700" // Gold/yellow color
        ctx.strokeStyle = "#FFA500" // Orange outline
        ctx.lineWidth = 1

        // Draw banana body
        drawRoundedRect(ctx, x + 2, y, size - 4, size * 0.8, 4)
        ctx.fill()
        ctx.stroke()

        // Draw banana curve/stem
        ctx.fillStyle = "#8B4513" // Brown stem
        ctx.fillRect(x + size / 2 - 1, y - 2, 2, 4)
    }
}

const drawTree = (ctx: CanvasRenderingContext2D, tree: Tree): void => {
    // Make visual tree larger than collision radius
    const visualSize = tree.radius * 10 // Visual tree is 5x the collision radius
    const x = tree.position.x - visualSize / 2
    const y = tree.position.y - visualSize / 2

    if (treeSprite.complete && treeSprite.naturalWidth > 0) {
        ctx.drawImage(treeSprite, x, y, visualSize, visualSize)
    } else {
        // Fallback to simple circle if tree sprite not loaded
        ctx.fillStyle = "#22c55e"
        ctx.strokeStyle = "#16a34a"
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(tree.position.x, tree.position.y, visualSize / 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
    }
}

const drawDecoration = (ctx: CanvasRenderingContext2D, decoration: Decoration): void => {
    const size = decoration.size
    const x = decoration.position.x - size / 2
    const y = decoration.position.y - size / 2

    let sprite: HTMLImageElement
    let fallbackColor: string

    if (decoration.type === "stone") {
        sprite = stoneSprite
        fallbackColor = "#6b7280" // Gray for stones
    } else {
        sprite = grassSprite
        fallbackColor = "#22c55e" // Green for grass
    }

    if (sprite.complete && sprite.naturalWidth > 0) {
        ctx.drawImage(sprite, x, y, size, size)
    } else {
        // Fallback to simple shapes if sprites not loaded
        ctx.fillStyle = fallbackColor
        if (decoration.type === "stone") {
            ctx.fillRect(x + 2, y + 2, size - 4, size - 4) // Small square for stone
        } else {
            // Small grass tuft
            ctx.beginPath()
            ctx.arc(decoration.position.x, decoration.position.y, size / 3, 0, Math.PI * 2)
            ctx.fill()
        }
    }
}

const generateBackgroundCanvas = (width: number, height: number): HTMLCanvasElement => {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")!

    const pixelSize = 8 // Size of each grass pixel
    const grassColors = [
        "#52764c", // Dark forest green
        "#466d40", // Dark green
        "#516d40" // Medium dark green
    ]

    // Disable image smoothing for pixelated effect
    ctx.imageSmoothingEnabled = false

    for (let x = 0; x < width; x += pixelSize) {
        for (let y = 0; y < height; y += pixelSize) {
            // Use random color selection
            const colorIndex = Math.floor(Math.random() * grassColors.length)

            ctx.fillStyle = grassColors[colorIndex]
            ctx.fillRect(x, y, pixelSize, pixelSize)
        }
    }

    return canvas
}

// Create depth-sorted array of trees, bananas, and monkeys
const createDepthSortedObjects = (world: World, config: GameConfig): RenderObject[] => {
    const objects: RenderObject[] = []

    // Add trees
    for (const tree of config.trees) {
        objects.push({
            type: "tree",
            y: tree.position.y,
            data: tree
        })
    }

    // Add bananas
    for (const banana of world.bananas) {
        objects.push({
            type: "banana",
            y: banana.position.y,
            data: banana
        })
    }

    // Add monkeys
    for (const monkey of world.monkeys) {
        objects.push({
            type: "monkey",
            y: monkey.position.y,
            data: monkey
        })
    }

    // Sort by Y position (top to bottom)
    return objects.sort((a, b) => a.y - b.y)
}

export const renderWorld = (ctx: CanvasRenderingContext2D, world: World, config: GameConfig): void => {
    ctx.clearRect(0, 0, config.width, config.height)

    // Generate background canvas once and cache it
    if (
        !backgroundGenerated ||
        !backgroundCanvas ||
        backgroundCanvas.width !== config.width ||
        backgroundCanvas.height !== config.height
    ) {
        backgroundCanvas = generateBackgroundCanvas(config.width, config.height)
        backgroundGenerated = true
    }

    // Draw cached background
    ctx.drawImage(backgroundCanvas, 0, 0)

    // Draw decorations first (always in background)
    for (const decoration of config.decorations) {
        drawDecoration(ctx, decoration)
    }

    // Get depth-sorted objects and render them (trees and monkeys in depth order)
    const depthSortedObjects = createDepthSortedObjects(world, config)

    for (const obj of depthSortedObjects) {
        if (obj.type === "tree") {
            drawTree(ctx, obj.data as Tree)
        } else if (obj.type === "banana") {
            drawBanana(ctx, obj.data as Banana)
        } else if (obj.type === "monkey") {
            drawMonkey(ctx, obj.data as Monkey)
        }
    }
}
