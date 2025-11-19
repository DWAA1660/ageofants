// Global game configuration for Ant Empire: factions, resources, costs, and stats.
// Shared by entities and the core game loop.

window.C = {
    factions: {
        player: { color: '#3b82f6', dark: '#1d4ed8', name: "Blue Empire", team: 1 },
        ally:   { color: '#22d3ee', dark: '#0e7490', name: "River Tribe", team: 1 },
        enemy1: { color: '#ef4444', dark: '#b91c1c', name: "Fire Clan", team: 2 },
        enemy2: { color: '#a855f7', dark: '#7e22ce', name: "Void Swarm", team: 2 },
        enemy3: { color: '#f97316', dark: '#c2410c', name: "Ember Brood", team: 2 },
        enemy4: { color: '#22c55e', dark: '#15803d', name: "Moss Legion", team: 2 },
        enemy5: { color: '#eab308', dark: '#a16207', name: "Gold Nest", team: 2 },
        enemy6: { color: '#06b6d4', dark: '#0e7490', name: "Tide Swarm", team: 2 }
    },
    resources: {
        food:  { color: '#4ade80', radius: 5, yield: 280, symbol: '🍏' },
        wood:  { color: '#a87139', radius: 6, yield: 120, symbol: '🪵' },
        stone: { color: '#9ca3af', radius: 7, yield: 120, symbol: '🪨' }
    },
    costs: {
        worker: { food: 10, wood: 0, stone: 0 },
        soldier: { food: 20, wood: 10, stone: 0 },
        elite:  { food: 40, wood: 20, stone: 10 }
    },
    stats: {
        worker: { hp: 15, dmg: 1, speed: 1.5, range: 5, sight: 100 },
        soldier: { hp: 60, dmg: 3, speed: 1.8, range: 15, sight: 150 },
        elite:   { hp: 150, dmg: 6, speed: 1.2, range: 18, sight: 120 }
    }
};
