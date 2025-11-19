// Core game logic and rendering for Ant Empire: Age of Stone.
// Extracted from index.html into a standalone module so the HTML stays clean.

(function() {
    // Note: In a real environment, the API key would be securely provided.
    const apiKey = "";

    // --- Constants & Config ---
    const C = {
        factions: {
            player: { color: '#3b82f6', dark: '#1d4ed8', name: "Blue Empire" },
            ally:   { color: '#22d3ee', dark: '#0e7490', name: "River Tribe" },
            enemy1: { color: '#ef4444', dark: '#b91c1c', name: "Fire Clan" },
            enemy2: { color: '#a855f7', dark: '#7e22ce', name: "Void Swarm" }
        },
        resources: {
            food:  { color: '#4ade80', radius: 5, yield: 50, symbol: '🍏' },
            wood:  { color: '#a87139', radius: 6, yield: 80, symbol: '🪵' },
            stone: { color: '#9ca3af', radius: 7, yield: 150, symbol: '🪨' }
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

    // --- Math Helpers ---
    class Vector {
        constructor(x, y) { this.x = x; this.y = y; }
        add(v) { return new Vector(this.x + v.x, this.y + v.y); }
        sub(v) { return new Vector(this.x - v.x, this.y - v.y); }
        mult(n) { return new Vector(this.x * n, this.y * n); }
        mag() { return Math.sqrt(this.x * this.x + this.y * this.y); }
        normalize() { 
            const m = this.mag(); 
            return m === 0 ? new Vector(0,0) : new Vector(this.x / m, this.y / m); 
        }
        dist(v) { return Math.sqrt((this.x - v.x)**2 + (this.y - v.y)**2); }
    }

    // --- Entities ---
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
        constructor(x, y, faction, type, game) {
            super(x, y, 0, C.factions[faction].color);
            this.faction = faction;
            this.type = type; // worker, soldier, elite
            this.game = game;
            
            const stats = C.stats[type];
            this.radius = type === 'elite' ? 8 : (type === 'soldier' ? 5 : 3);
            this.hp = stats.hp;
            this.maxHp = stats.hp;
            this.damage = stats.dmg;
            this.speed = stats.speed;
            this.range = stats.range;
            this.sight = stats.sight;
            
            this.attackCooldown = 0;
            this.state = 'IDLE';
            this.target = null;
            this.carrying = null; // {type, amount}
            this.job = 'general'; // general, farmer, lumberjack, miner
            this.manualCommand = false;
            
            this.angle = Math.random() * Math.PI * 2;
            this.legOffset = 0;
        }

        update() {
            if (this.attackCooldown > 0) this.attackCooldown--;

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
                    const enemy = this.findNearestEnemy(this.sight * 1.5);
                    if (enemy) {
                        this.target = enemy;
                        this.state = 'ATTACK';
                    } else if (queen) {
                        // Patrol near queen
                        if (this.pos.dist(queen.pos) > 250) {
                            this.target = queen;
                            this.state = 'MOVE';
                        } else {
                            this.state = 'IDLE';
                            this.target = null;
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
                    // Find Resource based on JOB
                    this.target = this.findResourceByJob();
                    this.state = 'GATHER';
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
                    // If specialized, prioritize their type
                    if (preferredType && e.type !== preferredType) {
                        // Only consider non-preferred resources if no preferred resources exist within a reasonable range
                        const d = this.pos.dist(e.pos);
                        if (d < minD) {
                            minD = d;
                            best = e;
                        }
                    } else if (preferredType === e.type) {
                        // Prioritize preferred type, regardless of range comparison with non-preferred
                        const d = this.pos.dist(e.pos);
                        if (d < minD) {
                            minD = d;
                            best = e;
                        }
                    }
                }
            });
            return best;
        }

        findNearestEnemy(range) {
            let best = null;
            let minD = range || Infinity;
            const myFac = this.faction;

            this.game.entities.forEach(e => {
                if ((e instanceof Ant || e instanceof Queen) && !e.markedForDeletion && e.faction !== myFac) {
                    // Alliance Logic (Player/Ally are friends)
                    const isFriendly = (myFac === 'player' && e.faction === 'ally') || (myFac === 'ally' && e.faction === 'player');
                    if (isFriendly) return;
                    
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
                    if(this.target.takeDamage) this.target.takeDamage(this.damage);
                    this.attackCooldown = 30; // 0.5 sec attack speed
                } else if (this.state === 'GATHER') {
                    if (this.target instanceof Resource) {
                        // Gather logic
                        this.carrying = { type: this.target.type, amount: 1 };
                        this.target.amount--;
                        if (this.target.amount <= 0) this.target.markedForDeletion = true;
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

    // --- Game Engine ---
    class Game {
        constructor() {
            this.canvas = document.getElementById('gameCanvas');
            this.ctx = this.canvas.getContext('2d');
            this.resize();
            window.addEventListener('resize', () => this.resize());

            this.playerResources = { food: 50, wood: 50, stone: 0 };
            this.entities = [];
            this.queens = [];
            this.particles = [];
            this.selectedEntities = [];
            
            // UI Helpers - defined early so other methods can use them
            this.ui = {
                spawnFloatText: (t,x,y,c) => {
                    const e = document.createElement('div');
                    e.className='floating-text'; e.innerText=t; e.style.left=x+'px'; e.style.top=y+'px'; e.style.color=c;
                    document.body.appendChild(e); setTimeout(()=>e.remove(),1500);
                },
                notify: (m, isError = false) => {
                    const e = document.getElementById('notification-area');
                    e.innerText=m; e.style.color = isError?'#ef4444':'#fcd34d';
                    setTimeout(()=>e.innerText='',2500);
                },
                closeMenu: () => document.getElementById('context-menu').classList.add('hidden')
            };
            
            // Input
            this.dragStart = null;
            this.currDrag = null;
            this.setupInput();

            // World Generation
            this.initWorld();

            // Loop
            this.frameCount = 0;
            this.loop = this.loop.bind(this); 
            requestAnimationFrame(this.loop);
        }

        loop() {
            this.frameCount++;
            this.update();
            this.draw();
            requestAnimationFrame(this.loop);
        }

        initWorld() {
            this.entities = [];
            this.queens = [];
            const w = this.canvas.width;
            const h = this.canvas.height;

            // Spawn 4 Queens in corners
            this.spawnQueen(100, 100, 'player');
            this.spawnQueen(w-100, 100, 'ally');
            this.spawnQueen(100, h-100, 'enemy1');
            this.spawnQueen(w-100, h-100, 'enemy2');

            // Populate Resources
            for(let i=0; i<25; i++) this.spawnResource('food');
            for(let i=0; i<15; i++) this.spawnResource('wood');
            for(let i=0; i<10; i++) this.spawnResource('stone');

            // Starting Units
            for(let i=0; i<5; i++) this.spawnAnt('worker', 'player', 120, 120 + i*5);
            for(let i=0; i<2; i++) this.spawnAnt('soldier', 'player', 150, 120 + i*5);
        }

        spawnQueen(x, y, fac) {
            const q = new Queen(x, y, fac);
            this.queens.push(q);
            this.entities.push(q);
        }

        spawnAnt(type, fac='player', x=null, y=null) {
            const cost = C.costs[type];
            
            if (fac === 'player') {
                if (this.playerResources.food < cost.food || 
                    this.playerResources.wood < cost.wood || 
                    this.playerResources.stone < cost.stone) {
                    this.ui.notify("Insufficient Resources!", true);
                    return;
                }
                this.playerResources.food -= cost.food;
                this.playerResources.wood -= cost.wood;
                this.playerResources.stone -= cost.stone;
            } else {
                // AI cost check
                const q = this.queens.find(qu => qu.faction === fac);
                if (!q || q.resources.food < cost.food || q.resources.wood < cost.wood || q.resources.stone < cost.stone) {
                    return;
                }
                q.resources.food -= cost.food;
                q.resources.wood -= cost.wood;
                q.resources.stone -= cost.stone;
            }

            const q = this.queens.find(qu => qu.faction === fac);
            if (!q) return;

            const ax = x || q.pos.x + (Math.random()-0.5)*40;
            const ay = y || q.pos.y + (Math.random()-0.5)*40;
            
            this.entities.push(new Ant(ax, ay, fac, type, this));
            
            // Close hatchery menu after spawning
            this.ui.closeMenu();
        }

        spawnResource(type) {
            const m = 50; // margin
            const x = m + Math.random() * (this.canvas.width - m*2);
            const y = m + Math.random() * (this.canvas.height - m*2);
            this.entities.push(new Resource(x, y, type || (Math.random()>0.5?'food':'wood')));
        }

        resize() {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        }

        setupInput() {
            this.canvas.addEventListener('mousedown', e => {
                const p = new Vector(e.clientX, e.clientY);
                if (e.button === 0) {
                    this.dragStart = p;
                    this.currDrag = p;
                    this.ui.closeMenu();
                } else if (e.button === 2) {
                    e.preventDefault();
                    this.handleCommand(p);
                }
            });
            this.canvas.addEventListener('mousemove', e => {
                if (this.dragStart) this.currDrag = new Vector(e.clientX, e.clientY);
            });
            this.canvas.addEventListener('mouseup', e => {
                if (e.button === 0 && this.dragStart) {
                    this.handleSelect(this.dragStart, new Vector(e.clientX, e.clientY));
                    this.dragStart = null;
                    this.currDrag = null;
                }
            });
            this.canvas.addEventListener('contextmenu', e => e.preventDefault());
        }

        handleSelect(start, end) {
            const d = start.dist(end);
            this.selectedEntities = [];
            
            if (d < 10) {
                // Single Click
                const clicked = this.entities.find(e => e.pos.dist(end) < e.radius + 10 && !e.markedForDeletion);
                if (clicked && clicked.faction === 'player') {
                    if (clicked instanceof Queen) {
                        // Open Queen Hatchery Menu
                        document.getElementById('context-menu').classList.remove('hidden');
                    } else {
                        this.selectedEntities = [clicked];
                        this.ui.closeMenu();
                    }
                } else {
                    this.ui.closeMenu();
                }
            } else {
                // Box Select
                const x1=Math.min(start.x,end.x), x2=Math.max(start.x,end.x);
                const y1=Math.min(start.y,end.y), y2=Math.max(start.y,end.y);
                
                this.entities.forEach(e => {
                    if (e instanceof Ant && e.faction === 'player' && !e.markedForDeletion) {
                        if (e.pos.x > x1 && e.pos.x < x2 && e.pos.y > y1 && e.pos.y < y2) {
                            this.selectedEntities.push(e);
                        }
                    }
                });
                this.ui.closeMenu();
            }
        }

        handleCommand(pos) {
            if (this.selectedEntities.length === 0) return;

            let target = null;
            // Hit detection (prioritize enemies/resources)
            for(const e of this.entities) {
                if (e.pos.dist(pos) < e.radius + 10 && !e.markedForDeletion) {
                    target = e;
                    break;
                }
            }

            let commandIssued = false;
            this.selectedEntities.forEach(ant => {
                ant.manualCommand = true;
                ant.state = 'IDLE'; 

                if (target) {
                    if (target instanceof Resource && ant.type === 'worker') {
                        // GATHER command
                        if (target.type === 'food') ant.job = 'farmer';
                        else if (target.type === 'wood') ant.job = 'lumberjack';
                        else if (target.type === 'stone') ant.job = 'miner';
                        
                        ant.target = target;
                        ant.state = 'GATHER';
                        commandIssued = true;
                    } else if (target.faction && target.faction !== 'player' && target.faction !== 'ally') {
                        // ATTACK command
                        ant.target = target;
                        ant.state = 'ATTACK';
                        commandIssued = true;
                    } else {
                        // MOVE/SUPPORT command (move near the target)
                        ant.target = { pos: pos, radius: 0 };
                        ant.state = 'MOVE';
                        commandIssued = true;
                    }
                } else {
                    // MOVE to ground command
                    const noise = new Vector((Math.random()-0.5)*20, (Math.random()-0.5)*20);
                    ant.target = { pos: pos.add(noise), radius: 0 };
                    ant.state = 'MOVE';
                    commandIssued = true;
                }
            });

            if (commandIssued) {
                this.createParticles(pos.x, pos.y, 'white', 5);
                this.ui.notify(`Issued command to ${this.selectedEntities.length} ants.`);
            }
        }

        // AI Logic for Enemy Factions
        updateAI() {
            // Simple AI Tick every 45 frames (0.75s)
            if (this.frameCount % 45 !== 0) return;

            this.queens.forEach(q => {
                if (q.faction === 'player' || q.markedForDeletion) return;
                
                const r = q.resources;
                const myAnts = this.entities.filter(e => e instanceof Ant && e.faction === q.faction);
                const workers = myAnts.filter(a => a.type === 'worker').length;
                const soldiers = myAnts.filter(a => a.type === 'soldier').length;
                const elites = myAnts.filter(a => a.type === 'elite').length;

                // 1. Production Logic: Balance workers and combat units
                if (workers < 15 && r.food >= C.costs.worker.food) {
                    this.spawnAnt('worker', q.faction);
                } else if (soldiers < 8 && r.food >= C.costs.soldier.food && r.wood >= C.costs.soldier.wood) {
                    this.spawnAnt('soldier', q.faction);
                } else if (elites < 3 && r.food >= C.costs.elite.food && r.wood >= C.costs.elite.wood && r.stone >= C.costs.elite.stone) {
                    this.spawnAnt('elite', q.faction);
                }
                
                // 2. Resource Injection (Cheat for stability/difficulty)
                if (this.frameCount % 300 === 0) { // every 5s
                    r.food += 10; r.wood += 5; r.stone += 1;
                }
            });
        }

        update() {
            // Resource Respawn (Every 15s)
            if (this.frameCount % 900 === 0) {
                const types = ['food', 'wood', 'stone'];
                this.spawnResource(types[Math.floor(Math.random() * types.length)]);
            }

            this.updateAI();

            // Entities Update
            this.entities.forEach(e => { if(e.update) e.update(); });
            this.entities = this.entities.filter(e => !e.markedForDeletion);
            this.selectedEntities = this.selectedEntities.filter(e => !e.markedForDeletion);

            // Particles Update
            this.particles.forEach(p => p.update());
            this.particles = this.particles.filter(p => p.life > 0);

            // UI Updates
            document.getElementById('res-food').innerText = Math.floor(this.playerResources.food);
            document.getElementById('res-wood').innerText = Math.floor(this.playerResources.wood);
            document.getElementById('res-stone').innerText = Math.floor(this.playerResources.stone);
            document.getElementById('res-pop').innerText = this.entities.filter(e => e instanceof Ant && e.faction === 'player').length;
        }

        draw() {
            // 1. BG (Dirt/Soil)
            this.ctx.fillStyle = '#3a2e26';
            this.ctx.fillRect(0,0,this.canvas.width, this.canvas.height);
            
            // 2. Grid (Subtle)
            this.ctx.strokeStyle = '#4a3b32'; this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            for(let i=0; i<this.canvas.width; i+=40) { this.ctx.moveTo(i,0); this.ctx.lineTo(i,this.canvas.height); }
            for(let i=0; i<this.canvas.height; i+=40) { this.ctx.moveTo(0,i); this.ctx.lineTo(this.canvas.width,i); }
            this.ctx.stroke();

            // 3. Entities (Y-sort for depth effect)
            this.entities.sort((a,b) => a.pos.y - b.pos.y);
            this.entities.forEach(e => e.draw(this.ctx));

            // 4. Particles
            this.particles.forEach(p => p.draw(this.ctx));

            // 5. Drag Box
            if (this.dragStart && this.currDrag) {
                const s = this.dragStart; const e = this.currDrag;
                const x = Math.min(s.x,e.x); const y = Math.min(s.y,e.y);
                const w = Math.abs(s.x-e.x); const h = Math.abs(s.y-e.y);
                this.ctx.strokeStyle = '#3b82f6'; this.ctx.lineWidth = 2;
                this.ctx.strokeRect(x,y,w,h);
                this.ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
                this.ctx.fillRect(x,y,w,h);
            }
        }

        createParticles(x,y,c, count=5) {
            for(let i=0;i<count;i++) this.particles.push(new Particle(x,y,c, 2));
        }

        gameOver(win) {
            // Use custom UI instead of alert()
            const message = win ? "VICTORY! The Ant Empire Triumphs!" : "DEFEAT! The Queen Has Fallen!";
            this.ui.notify(message, !win);
            
            // Simple modal effect
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[1000]';
            modal.innerHTML = `
                <div class="glass-panel p-8 rounded-xl text-center text-white retro-text max-w-sm">
                    <h1 class="text-3xl mb-4 ${win ? 'text-green-400' : 'text-red-400'}">${message}</h1>
                    <p class="text-sm mb-6 font-normal">Your campaign has ended.</p>
                    <button onclick="location.reload()" class="bg-blue-600 hover:bg-blue-700 text-white py-2 px-6 rounded-lg transition text-base shadow-lg">Start New Colony</button>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // AI Model Integration for Advisor
        async askAdvisor() {
            const bubble = document.getElementById('advisor-response');
            const textEl = document.getElementById('advisor-text');
            bubble.style.display = 'block';
            textEl.textContent = "Consulting the hive mind...";
            
            const pop = document.getElementById('res-pop').innerText;
            const prompt = `You are the Royal Ant Advisor for the Blue Empire. Give a concise, one-sentence tactical recommendation based on the current state. Status: Food ${this.playerResources.food}, Wood ${this.playerResources.wood}, Stone ${this.playerResources.stone}, Pop ${pop} (Focus on gathering if resources are low, or military if population is high).`;

            try {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });
                const data = await res.json();
                textEl.textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || "The pheromones are too faint to read, Your Majesty.";
            } catch(e) { 
                textEl.textContent = "Error contacting external hive mind. Check your connection or API key."; 
            }
        }
    }

    // Initialize the game
    window.onload = function() {
        window.game = new Game();
    };
})();
