// Game entities: base Entity and concrete types (Resource, Queen, Ant, Particle).
// Depends on global C and Vector.

class Entity {
    constructor(x, y, radius, color) {
        this.pos = new Vector(x, y);
        this.radius = radius;
        this.color = color;
        this.markedForDeletion = false;
    }
    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
    }
}

class Resource extends Entity {
    constructor(x, y, type) {
        const cfg = C.resources[type];
        super(x, y, cfg.radius, cfg.color);
        this.type = type;
        this.amount = cfg.yield;
        this.maxAmount = cfg.yield;
    }
    
    draw(ctx) {
        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        
        // Scale based on amount remaining
        const scale = 0.5 + (0.5 * (this.amount / this.maxAmount));
        ctx.scale(scale, scale);

        // Draw the resource shape
        ctx.globalAlpha = 0.8 + (0.2 * (this.amount / this.maxAmount));
        if(this.type === 'food') {
            ctx.fillStyle = '#22c55e';
            ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = '#14532d'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(-3, -3); ctx.lineTo(3, 3); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-3, 3); ctx.lineTo(3, -3); ctx.stroke();
        } else if (this.type === 'wood') {
            ctx.fillStyle = '#854d0e';
            ctx.fillRect(-this.radius, -this.radius/2, this.radius*2, this.radius);
            ctx.strokeStyle = '#451a03';
            ctx.strokeRect(-this.radius, -this.radius/2, this.radius*2, this.radius);
        } else if (this.type === 'stone') {
            ctx.fillStyle = '#6b7280';
            ctx.beginPath();
            ctx.moveTo(0, -this.radius); ctx.lineTo(this.radius, 0); ctx.lineTo(0, this.radius);
            ctx.lineTo(-this.radius, 0); ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#374151'; ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }
}

class Queen extends Entity {
    constructor(x, y, faction) {
        super(x, y, 14, C.factions[faction].dark);
        this.faction = faction;
        this.team = C.factions[faction].team != null ? C.factions[faction].team : 0;
        this.hp = 1000;
        this.maxHp = 1000;
        // AI Resources
        this.resources = { food: 50, wood: 50, stone: 0 };
        this.target = null;
    }

    update() {
        // Simple Queen logic: heal nearby units or just stand still
        if (this.hp < this.maxHp) this.hp += 0.05; 
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        
        // Selection Ring
        if (this.faction === 'player' && game.selectedEntities.includes(this)) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI*2); ctx.stroke();
        }

        // Body
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.ellipse(-10, 0, 16, 12, 0, 0, Math.PI*2); ctx.fill(); // Abdomen
        ctx.beginPath(); ctx.ellipse(6, 0, 10, 8, 0, 0, Math.PI*2); ctx.fill(); // Thorax
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(14, 0, 6, 0, Math.PI*2); ctx.fill(); // Head
        
        // HP Bar
        ctx.fillStyle = 'red'; ctx.fillRect(-15, -22, 30, 4);
        ctx.fillStyle = '#0f0'; ctx.fillRect(-15, -22, 30 * (this.hp / this.maxHp), 4);

        ctx.restore();
    }

    takeDamage(amount) {
        this.hp -= amount;
        game.createParticles(this.pos.x, this.pos.y, 'red', 10);
        if (this.hp <= 0) {
            this.markedForDeletion = true;
            if (this.faction === 'player') game.gameOver(false);
            else game.ui.notify(`${C.factions[this.faction].name} Queen defeated!`, false);
        }
    }
}

class Ant extends Entity {
    constructor(x, y, faction, type, gameInstance) {
        super(x, y, 0, C.factions[faction].color);
        this.faction = faction;
        this.type = type; // worker, soldier, elite
        this.game = gameInstance;
        
        const stats = C.stats[type];
        this.radius = type === 'elite' ? 8 : (type === 'soldier' ? 5 : 3);
        this.hp = stats.hp;
        this.maxHp = stats.hp;
        this.damage = stats.dmg;
        this.speed = stats.speed;
        this.range = stats.range;
        this.sight = stats.sight;
        
        this.team = gameInstance.getTeam ? gameInstance.getTeam(faction) : (C.factions[faction].team || 0);
        this.attackCooldown = 0;
        this.state = 'IDLE';
        this.target = null;
        this.carrying = null; // {type, amount}
        this.job = 'general'; // general, farmer, lumberjack, miner
        this.manualCommand = false;
        this.patrolPoint = null; // optional {x, y} area to guard for combat units
        
        this.angle = Math.random() * Math.PI * 2;
        this.legOffset = 0;
    }

    update() {
        if (this.attackCooldown > 0) this.attackCooldown--;
        
        // Opportunistic auto-aggro for combat units (does not override manual orders)
        if (this.type !== 'worker' && !this.manualCommand) {
            // Use sight radius so they notice enemies a bit away and move to engage
            const nearbyEnemy = this.findNearestEnemy(this.sight);
            if (nearbyEnemy) {
                this.target = nearbyEnemy;
                this.state = 'ATTACK';
            }
        }

        // State Machine
        if (this.manualCommand) {
            this.executeCommand();
        } else {
            this.runAI();
        }
        
        this.move();
    }

    // AI for non-selected/AI units
    runAI() {
        if (this.target && (this.target.markedForDeletion || this.target.hp <= 0)) {
            this.target = null;
            this.state = 'IDLE';
        }

        const queen = this.game.queens.find(q => q.faction === this.faction);

        if (this.type !== 'worker') {
            // Combat Unit AI
            if (this.state !== 'ATTACK' || !this.target) {
                // Look for nearest enemy around own queen first, then anywhere in sight
                let enemy = null;

                if (queen) {
                    let threatened = null;
                    let minQD = Infinity;
                    const myTeam = this.team;
                    this.game.entities.forEach(e => {
                        if ((e instanceof Ant || e instanceof Queen) && !e.markedForDeletion) {
                            const otherTeam = this.game.getTeam ? this.game.getTeam(e.faction) : (e.team ?? null);
                            if (otherTeam === myTeam) return;
                            const dQ = queen.pos.dist(e.pos);
                            if (dQ < 260 && dQ < minQD) { // "danger" radius around queen
                                minQD = dQ;
                                threatened = e;
                            }
                        }
                    });
                    if (threatened) enemy = threatened;
                }

                // Fallback to normal nearest-enemy search if no direct queen threat detected
                if (!enemy) {
                    enemy = this.findNearestEnemy(this.sight * 1.5);
                }

                if (enemy) {
                    this.target = enemy;
                    this.state = 'ATTACK';
                } else if (this.patrolPoint) {
                    // Move toward assigned patrol point and hold there
                    const patrolVec = new Vector(this.patrolPoint.x, this.patrolPoint.y);
                    if (this.pos.dist(patrolVec) > 40) {
                        this.target = { pos: patrolVec, radius: 0 };
                        this.state = 'MOVE';
                    } else {
                        this.state = 'IDLE';
                        this.target = null;
                    }
                } else if (queen) {
                    // Default behavior: wander; if scout is on for this faction, roam wider across the map
                    const factionScout = (this.game.scoutMode && this.faction === 'player') || this.game.aiScout[this.faction];
                    const distToQueen = this.pos.dist(queen.pos);
                    if (!factionScout && distToQueen > 300) {
                        // Defensive radius around queen when not scouting
                        this.target = queen;
                        this.state = 'MOVE';
                    } else if (!this.target || this.state === 'IDLE') {
                        let wanderPos;
                        if (factionScout) {
                            // Global scout: anywhere on the map; keep re-assigning so they never stop
                            const margin = 60;
                            const wx = margin + Math.random() * (this.game.canvas.width - margin * 2);
                            const wy = margin + Math.random() * (this.game.canvas.height - margin * 2);
                            wanderPos = new Vector(wx, wy);
                        } else {
                            // Local patrol around queen
                            const angle = Math.random() * Math.PI * 2;
                            const radius = 80 + Math.random() * 120; // ring around queen
                            wanderPos = new Vector(
                                queen.pos.x + Math.cos(angle) * radius,
                                queen.pos.y + Math.sin(angle) * radius
                            );
                        }
                        this.target = { pos: wanderPos, radius: 0 };
                        this.state = 'MOVE';
                    } else {
                        // Keep current move target if already wandering
                        this.state = 'MOVE';
                    }
                }
            }
        } else {
            // Worker Unit AI
            if (this.carrying) {
                // Go home to Queen
                this.target = queen;
                this.state = 'RETURN';
            } else if (!this.target) {
                // Find Resource strictly based on JOB (locked resource type)
                const res = this.findResourceByJob();
                if (res) {
                    this.target = res;
                    this.state = 'GATHER';

                    // If this worker was still general, its first resource choice defines its role
                    if (this.job === 'general') {
                        if (res.type === 'food') this.job = 'farmer';
                        else if (res.type === 'wood') this.job = 'lumberjack';
                        else if (res.type === 'stone') this.job = 'miner';
                    }
                } else {
                    // No appropriate resource available right now; stay idle near queen
                    this.state = 'IDLE';
                    this.target = null;
                }
            }
        }
    }

    // User Command execution
    executeCommand() {
        if (!this.target || (this.target.markedForDeletion || this.target.hp <= 0)) {
            this.manualCommand = false;
            this.state = 'IDLE';
            this.target = null;
            return;
        }
        
        // If successfully gathered, manually switch to RETURN state (overrides default AI)
        if (this.state === 'GATHER' && this.carrying) {
            this.target = this.game.queens.find(q => q.faction === this.faction);
            this.state = 'RETURN';
        }

        // Once delivered, manual command is complete
        if (this.state === 'RETURN' && !this.carrying) {
            this.manualCommand = false;
            this.target = null;
        }
    }

    findResourceByJob() {
        let preferredType = null;
        if (this.job === 'farmer') preferredType = 'food';
        if (this.job === 'lumberjack') preferredType = 'wood';
        if (this.job === 'miner') preferredType = 'stone';

        let best = null;
        let minD = Infinity;

        this.game.entities.forEach(e => {
            if (e instanceof Resource && !e.markedForDeletion && e.amount > 0) {
                // When a worker has a job, it is locked to that resource type
                if (preferredType) {
                    if (e.type !== preferredType) return;
                }

                const d = this.pos.dist(e.pos);
                if (d < minD) {
                    minD = d;
                    best = e;
                }
            }
        });
        return best;
    }

    findNearestEnemy(range) {
        let best = null;
        let minD = range || Infinity;
        const myTeam = this.game.getTeam ? this.game.getTeam(this.faction) : (this.team ?? null);

        this.game.entities.forEach(e => {
            if ((e instanceof Ant || e instanceof Queen) && !e.markedForDeletion) {
                const otherTeam = this.game.getTeam ? this.game.getTeam(e.faction) : (e.team ?? null);
                if (myTeam != null && otherTeam != null && otherTeam === myTeam) return;
                const d = this.pos.dist(e.pos);
                if (d < minD) {
                    minD = d;
                    best = e;
                }
            }
        });
        return best;
    }

    move() {
        if (!this.target) return;

        const dist = this.pos.dist(this.target.pos);
        let arriveRadius = this.target.radius + this.radius + 2; // Buffer

        // Combat units need to stay in range
        if (this.state === 'ATTACK') arriveRadius = this.range + this.target.radius;

        if (dist <= arriveRadius) {
            // Action at Target
            if (this.state === 'ATTACK' && this.attackCooldown <= 0) {
                if (this.target.takeDamage) this.target.takeDamage(this.damage);
                this.attackCooldown = 30; // 0.5 sec attack speed
            } else if (this.state === 'GATHER') {
                if (this.target instanceof Resource) {
                    // Gather logic
                    this.carrying = { type: this.target.type, amount: 1 };
                    this.target.amount--;
                    if (this.target.amount <= 0) {
                        this.target.markedForDeletion = true;
                        // Respawn a new random resource, biased toward food
                        let respawnType;
                        const r = Math.random();
                        if (r < 0.55) respawnType = 'food';
                        else if (r < 0.8) respawnType = 'wood';
                        else respawnType = 'stone';
                        this.game.spawnResource(respawnType);
                    }
                    this.game.createParticles(this.pos.x, this.pos.y, C.resources[this.target.type].color, 5);
                }
            } else if (this.state === 'RETURN') {
                // Deliver logic
                if (this.carrying) {
                    const q = this.target; // Queen
                    if (this.faction === 'player') {
                        this.game.playerResources[this.carrying.type] += 5;
                        this.game.ui.spawnFloatText(`+5${C.resources[this.carrying.type].symbol}`, this.pos.x, this.pos.y, C.resources[this.carrying.type].color);
                    } else {
                        q.resources[this.carrying.type] += 5;
                    }
                    this.carrying = null;
                    // After delivery, if not manual command, return to AI
                    if (!this.manualCommand) this.target = null;
                }
            }
        } else {
            // Pathing (Movement)
            const dir = this.target.pos.sub(this.pos).normalize();
            this.pos = this.pos.add(dir.mult(this.speed));
            this.angle = Math.atan2(dir.y, dir.x);
            this.legOffset += 0.5; // for leg animation
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        
        // Selection Ring
        if (this.faction === 'player' && game.selectedEntities.includes(this)) {
            ctx.strokeStyle = this.state === 'ATTACK' ? 'red' : '#fff'; 
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(0, 0, this.radius + 4, 0, Math.PI*2); ctx.stroke();
        }

        ctx.rotate(this.angle);

        // Unit Body and Type Visuals (simple ant shape)
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI*2); ctx.fill();

        // HP bar for combat units
        if (this.type !== 'worker') {
            const barWidth = this.radius * 2;
            const barHeight = 2;
            const hpRatio = Math.max(0, this.hp / this.maxHp);
            ctx.resetTransform();
            ctx.translate(this.pos.x, this.pos.y);
            ctx.fillStyle = 'rgba(60,20,20,0.8)';
            ctx.fillRect(-barWidth/2, -this.radius - 8, barWidth, barHeight);
            ctx.fillStyle = '#22c55e';
            ctx.fillRect(-barWidth/2, -this.radius - 8, barWidth * hpRatio, barHeight);
            ctx.translate(-this.pos.x, -this.pos.y);
            ctx.translate(this.pos.x, this.pos.y);
            ctx.rotate(this.angle);
        }

        // Job/Type Marker
        if (this.type === 'elite') {
            ctx.fillStyle = '#444';
            ctx.fillRect(-this.radius, -this.radius, this.radius*2, this.radius*2);
            ctx.fillStyle = 'gold';
            ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI*2); ctx.fill();
        } else if (this.type === 'soldier') {
            ctx.fillStyle = '#111';
            ctx.fillRect(this.radius-2, -2, 4, 4);
        }
        
        // Carrying Resource
        if (this.carrying) {
            ctx.fillStyle = C.resources[this.carrying.type].color;
            ctx.beginPath(); ctx.arc(this.radius + 2, -this.radius - 2, 2.5, 0, Math.PI*2); ctx.fill();
        }

        ctx.restore();
    }

    takeDamage(a) {
        this.hp -= a;
        this.game.createParticles(this.pos.x, this.pos.y, C.factions[this.faction].color, 3);
        if (this.hp <= 0) {
            this.markedForDeletion = true;
        }
    }
}

class Particle {
    constructor(x, y, c, r=2) {
        this.pos = new Vector(x, y);
        this.vel = new Vector((Math.random()-0.5)*2, (Math.random()-0.5)*2);
        this.life = 1.0;
        this.color = c;
        this.radius = r;
    }
    update() { this.pos = this.pos.add(this.vel); this.life -= 0.05; this.vel = this.vel.mult(0.95); }
    draw(ctx) {
        ctx.globalAlpha = this.life; ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.pos.x, this.pos.y, this.radius * this.life, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
    }
}

class Building extends Entity {
    constructor(x, y, faction, type, gameInstance) {
        super(x, y, 10, C.factions[faction].dark);
        this.faction = faction;
        this.type = type; // 'anthill'
        this.game = gameInstance;
        this.spawnCooldown = 0;
    }

    update() {
        if (this.type === 'anthill') {
            if (this.spawnCooldown > 0) this.spawnCooldown--;
            if (this.spawnCooldown <= 0) {
                // Spawn a soldier near the anthill every ~5 seconds (300 frames)
                this.game.spawnAnt('soldier', this.faction, this.pos.x + (Math.random()-0.5)*20, this.pos.y + (Math.random()-0.5)*20);
                this.spawnCooldown = 300;
            }
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);

        // Base mound
        ctx.fillStyle = '#4b2e16';
        ctx.beginPath(); ctx.arc(0, 0, this.radius + 4, 0, Math.PI*2); ctx.fill();

        // Faction-colored entrance
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI*2); ctx.fill();

        // Small entrance hole
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(0, 2, this.radius/2, 0, Math.PI*2); ctx.fill();

        ctx.restore();
    }
}

window.Entity = Entity;
window.Resource = Resource;
window.Queen = Queen;
window.Ant = Ant;
window.Particle = Particle;
window.Building = Building;
