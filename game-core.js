// Core game loop, input handling, AI, advisor, and initialization.
// Depends on C, Vector, Entity, Resource, Queen, Ant, Particle.

(function() {
    // Note: In a real environment, the API key would be securely provided.
    const apiKey = "";

    class Game {
        constructor(options = {}) {
            const aiCount = Math.max(1, Math.min(6, options.aiCount || 3));
            const difficulty = Math.max(1, Math.min(10, options.difficulty || 3));
            const teams = options.teams || {};
            this.canvas = document.getElementById('gameCanvas');
            this.ctx = this.canvas.getContext('2d');
            this.resize();
            window.addEventListener('resize', () => this.resize());

            this.playerResources = { food: 50, wood: 50, stone: 0 };
            this.entities = [];
            this.queens = [];
            this.particles = [];
            this.selectedEntities = [];
            this.difficulty = difficulty; // 1-10, affects AI aggression/efficiency
            this.aiCount = aiCount;
            this.teams = teams; // faction -> team number
            this.localFaction = options.localFaction || 'player';
            this.humanFactions = options.humanFactions || {};
            if (!this.humanFactions[this.localFaction]) {
                this.humanFactions[this.localFaction] = true;
            }
            this.net = window.net || null;
            this.isNetworked = !!options.isNetworked;
            this.isAuthoritative = !!options.isAuthoritative;
            this.playerId = options.playerId || (this.net && this.net.playerId) || null;
            this.tick = 0;
            this.latestSnapshot = null;
            this.entityById = {};
            this.lastSnapshotSentAt = 0;
            this.snapshotIntervalMs = 150;
            this.workerFocus = 'food';    // default focus for new player workers
            this.pendingBuild = null; // e.g. { type: 'anthill' }
            this.scoutMode = false;  // player-wide scout mode
            this.aiScout = {};       // per-faction scout mode for AI
            
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
            if (!this.isNetworked || this.isAuthoritative) {
                this.initWorld();
            }

            // Loop
            this.frameCount = 0;
            this.loop = this.loop.bind(this); 
            requestAnimationFrame(this.loop);
        }

        getTeam(faction) {
            if (!faction) return null;
            if (this.teams && this.teams[faction] != null) return this.teams[faction];
            const cfg = C.factions[faction];
            return cfg && cfg.team != null ? cfg.team : null;
        }

        toggleScoutMode() {
            this.scoutMode = !this.scoutMode;
            this.ui.notify(`Scout Mode: ${this.scoutMode ? 'ON' : 'OFF'}`);
        }

        setDifficulty(level) {
            this.difficulty = Math.max(1, Math.min(10, level));
            this.ui.notify(`AI Difficulty set to ${this.difficulty}`);
        }

        setWorkerFocus(resource) {
            if (!['food','wood','stone'].includes(resource)) return;
            this.workerFocus = resource;
            const label = resource === 'food' ? 'Food' : resource === 'wood' ? 'Wood' : 'Stone';
            this.ui.notify(`New workers will focus ${label}.`);
        }

        loop() {
            this.frameCount++;
            this.tick++;
            if (!this.isNetworked || this.isAuthoritative) {
                this.update();
            } else {
                this.applyLatestSnapshot();
            }
            this.draw();
            if (this.isNetworked && this.isAuthoritative) {
                this.maybeSendSnapshot();
            }
            requestAnimationFrame(this.loop);
        }

        initWorld() {
            this.entities = [];
            this.queens = [];
            const w = this.canvas.width;
            const h = this.canvas.height;

            // Spawn player Queen
            this.spawnQueen(100, 100, this.localFaction);

            // Up to 6 enemy factions placed around the map
            const aiFactions = ['enemy1', 'enemy2', 'enemy3', 'enemy4', 'enemy5', 'enemy6'];
            const positions = [
                { x: w - 100, y: 100 },          // top-right
                { x: 100, y: h - 100 },          // bottom-left
                { x: w - 100, y: h - 100 },      // bottom-right
                { x: w / 2, y: h - 120 },        // bottom-center
                { x: w - 120, y: h / 2 },        // mid-right
                { x: 120, y: h / 2 }             // mid-left
            ];

            for (let i = 0; i < this.aiCount; i++) {
                const fac = aiFactions[i];
                const pos = positions[i];
                if (!fac || !pos) break;
                this.spawnQueen(pos.x, pos.y, fac);
            }

            // Populate Resources
            for(let i=0; i<25; i++) this.spawnResource('food');
            for(let i=0; i<15; i++) this.spawnResource('wood');
            for(let i=0; i<10; i++) this.spawnResource('stone');

            // Starting Units for local player faction
            for(let i=0; i<5; i++) this.spawnAnt('worker', this.localFaction, 120, 120 + i*5);
            for(let i=0; i<2; i++) this.spawnAnt('soldier', this.localFaction, 150, 120 + i*5);

            // Difficulty scaling for AI economies and workers
            const diff = Math.max(1, Math.min(10, this.difficulty || 3));

            // AI advantage: start each non-local queen with difficulty * 5 workers
            const startWorkers = diff * 5;
            this.queens.forEach(q => {
                if (q.faction === this.localFaction) return;
                for (let i=0; i<startWorkers; i++) {
                    // Free starting workers for AI: bypass cost checks
                    const ax = q.pos.x + (Math.random()-0.5)*60;
                    const ay = q.pos.y + (Math.random()-0.5)*60;
                    this.entities.push(new Ant(ax, ay, q.faction, 'worker', this));
                }
            });

            // AI starting resources: scale with difficulty (e.g. level 10 ≈ 1000 of each)
            const baseStartRes = 100 * diff;
            this.queens.forEach(q => {
                if (q.faction === this.localFaction) return;
                q.resources.food = baseStartRes;
                q.resources.wood = baseStartRes;
                q.resources.stone = baseStartRes;
            });
        }

        spawnQueen(x, y, fac) {
            const q = new Queen(x, y, fac);
            q.team = this.getTeam(fac);
            this.queens.push(q);
            this.entities.push(q);
            if (q.id != null) this.entityById[q.id] = q;
        }

        spawnBuilding(x, y, fac, type='anthill') {
            const costWood = 500;

            if (fac === this.localFaction) {
                if (this.playerResources.wood < costWood) {
                    this.ui.notify("Not enough wood for Anthill (500🪵)", true);
                    return null;
                }
                this.playerResources.wood -= costWood;
            } else {
                const q = this.queens.find(qu => qu.faction === fac);
                if (!q || q.resources.wood < costWood) return null;
                q.resources.wood -= costWood;
            }

            const b = new Building(x, y, fac, type, this);
            this.entities.push(b);
            if (b.id != null) this.entityById[b.id] = b;
            return b;
        }

        spawnAnt(type, fac='player', x=null, y=null) {
            const cost = C.costs[type];
            
            if (this.isNetworked && !this.isAuthoritative && this.net && this.net.connected && this.net.code) {
                if (fac !== this.localFaction) return;
                this.net.send({
                    type: 'GAME_MESSAGE',
                    data: {
                        kind: 'COMMAND',
                        commandType: 'SPAWN',
                        playerId: this.playerId,
                        faction: fac,
                        unitType: type
                    }
                });
                return;
            }

            if (fac === this.localFaction) {
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
            
            const ant = new Ant(ax, ay, fac, type, this);
            // Apply default worker focus for local-player workers
            if (fac === this.localFaction && type === 'worker') {
                if (this.workerFocus === 'food') ant.job = 'farmer';
                else if (this.workerFocus === 'wood') ant.job = 'lumberjack';
                else if (this.workerFocus === 'stone') ant.job = 'miner';
            }
            this.entities.push(ant);
            if (ant.id != null) this.entityById[ant.id] = ant;
        }

        spawnResource(type) {
            const m = 50; // margin
            const x = m + Math.random() * (this.canvas.width - m*2);
            const y = m + Math.random() * (this.canvas.height - m*2);
            // Bias: food more common than wood/stone when random
            let randomType;
            const r = Math.random();
            if (r < 0.55) randomType = 'food';       // ~55%
            else if (r < 0.8) randomType = 'wood';   // ~25%
            else randomType = 'stone';               // ~20%
            const res = new Resource(x, y, type || randomType);
            this.entities.push(res);
            if (res.id != null) this.entityById[res.id] = res;
        }

        buildAnthill() {
            // Enter placement mode; actual build happens on next left-click
            this.pendingBuild = { type: 'anthill' };
            this.ui.notify("Click on the map to place your Anthill (500🪵).", false);
        }

        resize() {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        }

        setupInput() {
            this.canvas.addEventListener('mousedown', e => {
                const p = new Vector(e.clientX, e.clientY);
                if (e.button === 0) {
                    // If we are in a building placement mode, place the building instead of starting selection
                    if (this.pendingBuild && this.pendingBuild.type === 'anthill') {
                        if (this.isNetworked && !this.isAuthoritative && this.net && this.net.connected && this.net.code) {
                            this.net.send({
                                type: 'GAME_MESSAGE',
                                data: {
                                    kind: 'COMMAND',
                                    commandType: 'BUILD',
                                    playerId: this.playerId,
                                    faction: this.localFaction,
                                    buildType: 'anthill',
                                    pos: { x: p.x, y: p.y }
                                }
                            });
                        } else {
                            this.spawnBuilding(p.x, p.y, this.localFaction, 'anthill');
                        }
                        this.pendingBuild = null;
                    } else {
                        this.dragStart = p;
                        this.currDrag = p;
                        this.ui.closeMenu();
                    }
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
                if (clicked && clicked.faction === this.localFaction) {
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
                    if (e instanceof Ant && e.faction === this.localFaction && !e.markedForDeletion) {
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

            if (this.isNetworked && !this.isAuthoritative && this.net && this.net.connected && this.net.code) {
                const payload = {
                    kind: 'COMMAND',
                    commandType: 'RIGHT_CLICK',
                    playerId: this.playerId,
                    faction: this.localFaction,
                    pos: { x: pos.x, y: pos.y },
                    selectedIds: this.selectedEntities.map(e => e.id)
                };
                this.net.send({ type: 'GAME_MESSAGE', data: payload });
                this.createParticles(pos.x, pos.y, 'white', 5);
                this.ui.notify(`Issued command to ${this.selectedEntities.length} ants.`);
                return;
            }

            this.issueLocalCommand(pos, this.selectedEntities);
        }

        issueLocalCommand(pos, selection) {
            if (!selection || selection.length === 0) return;

            let target = null;
            // Hit detection (prioritize enemies/resources)
            for(const e of this.entities) {
                if (e.pos.dist(pos) < e.radius + 10 && !e.markedForDeletion) {
                    target = e;
                    break;
                }
            }

            let commandIssued = false;
            selection.forEach(ant => {
                ant.state = 'IDLE';

                if (target) {
                    ant.manualCommand = true;
                    // Any explicit target clears previous patrol
                    ant.patrolPoint = null;

                    if (target instanceof Resource && ant.type === 'worker') {
                        // GATHER command
                        if (target.type === 'food') ant.job = 'farmer';
                        else if (target.type === 'wood') ant.job = 'lumberjack';
                        else if (target.type === 'stone') ant.job = 'miner';
                        
                        ant.target = target;
                        ant.state = 'GATHER';
                        commandIssued = true;
                    } else if (target.faction) {
                        const myTeam = this.getTeam(this.localFaction);
                        const targetTeam = this.getTeam(target.faction);
                        if (targetTeam == null || myTeam == null || targetTeam !== myTeam) {
                            // ATTACK command vs enemy team
                            ant.target = target;
                            ant.state = 'ATTACK';
                            commandIssued = true;
                        } else {
                            // Same team: just move near the ally/structure
                            ant.target = { pos: pos, radius: 0 };
                            ant.state = 'MOVE';
                            commandIssued = true;
                        }
                    } else {
                        // MOVE/SUPPORT command (move near the target)
                        ant.target = { pos: pos, radius: 0 };
                        ant.state = 'MOVE';
                        commandIssued = true;
                    }
                } else {
                    // MOVE to ground command
                    const noise = new Vector((Math.random()-0.5)*20, (Math.random()-0.5)*20);
                    const patrolPos = pos.add(noise);
                    ant.target = { pos: patrolPos, radius: 0 };
                    ant.state = 'MOVE';

                    if (ant.type !== 'worker') {
                        // For combat units, treat this as setting a patrol area
                        ant.patrolPoint = { x: patrolPos.x, y: patrolPos.y };
                        ant.manualCommand = false; // let their AI handle patrolling + fighting
                    } else {
                        // For workers, keep old manual move behavior
                        ant.manualCommand = true;
                    }
                    commandIssued = true;
                }
            });

            if (commandIssued) {
                this.createParticles(pos.x, pos.y, 'white', 5);
                this.ui.notify(`Issued command to ${selection.length} ants.`);
            }
        }

        handleNetMessage(msg) {
            const data = msg && msg.data ? msg.data : null;
            if (!data) return;
            if (data.kind === 'COMMAND') {
                if (!this.isAuthoritative) return;
                const cmdType = data.commandType || 'RIGHT_CLICK';
                if (cmdType === 'SPAWN') {
                    const fac = data.faction || this.localFaction;
                    const unitType = data.unitType || 'worker';
                    this.spawnAnt(unitType, fac);
                    return;
                }
                if (cmdType === 'BUILD') {
                    const fac = data.faction || this.localFaction;
                    const buildType = data.buildType || 'anthill';
                    const posData = data.pos || { x: 0, y: 0 };
                    this.spawnBuilding(posData.x, posData.y, fac, buildType);
                    return;
                }
                const posData = data.pos || { x: 0, y: 0 };
                const pos = new Vector(posData.x, posData.y);
                const ids = data.selectedIds || [];
                const selection = ids.map(id => this.entityById[id]).filter(e => !!e);
                this.issueLocalCommand(pos, selection);
            } else if (data.kind === 'SNAPSHOT') {
                if (!this.isNetworked || this.isAuthoritative) return;
                this.latestSnapshot = data.snapshot || null;
            }
        }

        maybeSendSnapshot() {
            if (!this.net || !this.net.connected || !this.net.code) return;
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (now - this.lastSnapshotSentAt < this.snapshotIntervalMs) return;
            this.lastSnapshotSentAt = now;

            const factionResources = {};
            this.queens.forEach(q => {
                let res;
                if (q.faction === this.localFaction) {
                    res = this.playerResources;
                } else {
                    res = q.resources;
                }
                factionResources[q.faction] = {
                    food: res.food,
                    wood: res.wood,
                    stone: res.stone
                };
            });

            const entitiesSnap = this.entities.map(e => {
                let kind = 'other';
                let type = null;
                if (e instanceof Ant) {
                    kind = 'ant';
                    type = e.type;
                } else if (e instanceof Queen) {
                    kind = 'queen';
                } else if (e instanceof Resource) {
                    kind = 'resource';
                    type = e.type;
                } else if (e instanceof Building) {
                    kind = 'building';
                    type = e.type;
                }
                return {
                    id: e.id,
                    kind,
                    type,
                    faction: e.faction || null,
                    x: e.pos.x,
                    y: e.pos.y,
                    hp: typeof e.hp === 'number' ? e.hp : null,
                    amount: e instanceof Resource ? e.amount : null
                };
            });

            const snapshot = {
                tick: this.tick,
                entities: entitiesSnap,
                factionResources,
                localFaction: this.localFaction
            };

            this.net.send({
                type: 'GAME_MESSAGE',
                data: {
                    kind: 'SNAPSHOT',
                    snapshot
                }
            });
        }

        applyLatestSnapshot() {
            const snap = this.latestSnapshot;
            if (!snap) return;

            const prevSelectedIds = this.selectedEntities.map(e => e.id);
            const idMap = {};
            const newEntities = [];
            const newQueens = [];

            const entitiesData = snap.entities || [];
            entitiesData.forEach(se => {
                if (se == null || se.id == null) return;
                let ent = this.entityById[se.id];
                if (!ent) {
                    const fx = se.faction || 'enemy1';
                    if (se.kind === 'queen') {
                        ent = new Queen(se.x, se.y, fx, se.id);
                    } else if (se.kind === 'ant') {
                        ent = new Ant(se.x, se.y, fx, se.type || 'worker', this, se.id);
                    } else if (se.kind === 'resource') {
                        ent = new Resource(se.x, se.y, se.type || 'food', se.id);
                    } else if (se.kind === 'building') {
                        ent = new Building(se.x, se.y, fx, se.type || 'anthill', this, se.id);
                    } else {
                        return;
                    }
                } else {
                    ent.pos.x = se.x;
                    ent.pos.y = se.y;
                }

                if (typeof se.hp === 'number' && ent.hp != null) {
                    ent.hp = se.hp;
                }
                if (se.kind === 'resource' && typeof se.amount === 'number') {
                    ent.amount = se.amount;
                }

                newEntities.push(ent);
                idMap[ent.id] = ent;
                if (ent instanceof Queen) newQueens.push(ent);
            });

            this.entities = newEntities;
            this.queens = newQueens;
            this.entityById = idMap;

            const factionResources = snap.factionResources || {};
            const myRes = factionResources[this.localFaction] || { food: 0, wood: 0, stone: 0 };
            this.playerResources = {
                food: myRes.food || 0,
                wood: myRes.wood || 0,
                stone: myRes.stone || 0
            };

            const pop = this.entities.filter(e => e instanceof Ant && e.faction === this.localFaction).length;
            const foodEl = document.getElementById('res-food');
            if (foodEl) foodEl.innerText = Math.floor(this.playerResources.food);
            const woodEl = document.getElementById('res-wood');
            if (woodEl) woodEl.innerText = Math.floor(this.playerResources.wood);
            const stoneEl = document.getElementById('res-stone');
            if (stoneEl) stoneEl.innerText = Math.floor(this.playerResources.stone);
            const popEl = document.getElementById('res-pop');
            if (popEl) popEl.innerText = pop;

            this.selectedEntities = prevSelectedIds.map(id => idMap[id]).filter(e => !!e);
        }

        // AI Logic for Enemy Factions
        updateAI() {
            // Simple AI Tick every 45 frames (0.75s)
            if (this.frameCount % 45 !== 0) return;

            const diff = Math.max(1, Math.min(10, this.difficulty || 3));
            const incomeScale = diff / 3; // 1: weak, 10: very strong cheats
            const baseWaveInterval = 900; // frames
            const waveInterval = Math.max(240, baseWaveInterval - diff * 60); // harder = more frequent
            const baseWaveSize = 4;

            const playerQueen = this.queens.find(qq => qq.faction === this.localFaction && !qq.markedForDeletion);

            this.queens.forEach(q => {
                if (q.markedForDeletion) return;

                if (this.humanFactions && this.humanFactions[q.faction]) return;
                
                const r = q.resources;
                const myAnts = this.entities.filter(e => e instanceof Ant && e.faction === q.faction);
                const workers = myAnts.filter(a => a.type === 'worker').length;
                const soldiers = myAnts.filter(a => a.type === 'soldier').length;
                const elites = myAnts.filter(a => a.type === 'elite').length;

                const myBuildings = this.entities.filter(e => e instanceof Building && e.faction === q.faction);

                // Target composition scales with difficulty
                const targetWorkers  = 12 + diff * 3;               // heavier eco at higher diff
                const targetSoldiers = 4 + Math.floor(diff * 3);    // much bigger armies
                const targetElites   = Math.floor(diff / 1.5);      // more elites on high diff

                // 1. Production Logic: try to reach target composition
                if (workers < targetWorkers && r.food >= C.costs.worker.food) {
                    // When very poor, only build workers
                    this.spawnAnt('worker', q.faction);
                } else if (soldiers < targetSoldiers && r.food >= C.costs.soldier.food && r.wood >= C.costs.soldier.wood) {
                    this.spawnAnt('soldier', q.faction);
                    // If very rich, build an extra soldier in the same tick
                    if (r.food > 4 * C.costs.soldier.food && r.wood > 4 * C.costs.soldier.wood && diff >= 7) {
                        this.spawnAnt('soldier', q.faction);
                    }
                } else if (elites < targetElites && r.food >= C.costs.elite.food && r.wood >= C.costs.elite.wood && r.stone >= C.costs.elite.stone) {
                    this.spawnAnt('elite', q.faction);
                } else if (diff >= 7 && r.food > 3 * C.costs.soldier.food && r.wood > 3 * C.costs.soldier.wood) {
                    // On very hard, dump excess into extra soldiers when rich
                    this.spawnAnt('soldier', q.faction);
                }

                // 1b. Strategic buildings: AI builds anthills when it has enough wood and few anthills
                if (diff >= 5 && myBuildings.length < Math.ceil(diff / 3) && r.wood >= 500) {
                    const offsetX = (Math.random()-0.5) * 80;
                    const offsetY = (Math.random()-0.5) * 80;
                    this.spawnBuilding(q.pos.x + offsetX, q.pos.y + offsetY, q.faction, 'anthill');
                }

                // 1c. AI scout mode: harder difficulties enable scouting for this faction
                if (diff >= 6) {
                    this.aiScout[q.faction] = true;
                } else if (diff <= 3) {
                    this.aiScout[q.faction] = false;
                }
                
                // 2. Resource Injection (Cheat for stability/difficulty)
                if (this.frameCount % 300 === 0) { // every ~5s, scaled by difficulty
                    r.food += 6 * incomeScale;
                    r.wood += 3 * incomeScale;
                    r.stone += 1 * incomeScale;
                }

                // 3. Coordinated attack waves toward the player's team from any non-player faction
                //    Do not allow waves in the first ~20 seconds to give the player a grace period.
                const playerTeam = this.getTeam(this.localFaction);
                const qTeam = this.getTeam(q.faction);
                const globalTargetQueen = playerQueen && qTeam !== playerTeam ? playerQueen : null;
                if (globalTargetQueen && this.frameCount >= 20 * 60 && this.frameCount % waveInterval === 0) {
                    const combatAnts = myAnts.filter(a => a.type !== 'worker');
                    const required = baseWaveSize + diff; // higher difficulty = bigger waves
                    if (combatAnts.length >= required) {
                        // All AI factions focus the same target queen for stronger coordinated pushes
                        combatAnts.forEach(a => {
                            a.manualCommand = true;
                            a.target = globalTargetQueen;
                            a.state = 'ATTACK';
                        });
                    }
                }
            });
        }

        update() {
            // Resource Respawn (Every 15s)
            if (false && this.frameCount % 900 === 0) {
                const types = ['food', 'wood', 'stone'];
                this.spawnResource(types[Math.floor(Math.random() * types.length)]);
            }

            this.updateAI();

            // Entities Update
            this.entities.forEach(e => { if(e.update) e.update(); });
            this.entities = this.entities.filter(e => !e.markedForDeletion);
            this.selectedEntities = this.selectedEntities.filter(e => !e.markedForDeletion);
            const map = {};
            this.entities.forEach(e => { if (e.id != null) map[e.id] = e; });
            this.entityById = map;

            // Particles Update
            this.particles.forEach(p => p.update());
            this.particles = this.particles.filter(p => p.life > 0);

            // UI Updates
            document.getElementById('res-food').innerText = Math.floor(this.playerResources.food);
            document.getElementById('res-wood').innerText = Math.floor(this.playerResources.wood);
            document.getElementById('res-stone').innerText = Math.floor(this.playerResources.stone);
            document.getElementById('res-pop').innerText = this.entities.filter(e => e instanceof Ant && e.faction === this.localFaction).length;
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

    window.Game = Game;

    window.startGame = function() {
        if (window.game) return;

        const aiSelect = document.getElementById('ai-count-select');
        const diffSelect = document.getElementById('difficulty-select');
        const colonySelect = document.getElementById('colony-select');
        const playerTeamSelect = document.getElementById('player-team-select');
        const aiTeamSelect = document.getElementById('ai-team-select');
        const aiCount = parseInt(aiSelect?.value || '3', 10);
        const difficulty = parseInt(diffSelect?.value || '3', 10);

        const localFaction = colonySelect?.value || 'player';
        const playerTeam = parseInt(playerTeamSelect?.value || '1', 10);
        const aiTeam = parseInt(aiTeamSelect?.value || '2', 10);

        const netObj = window.net;
        if (netObj && netObj.connected && netObj.code) {
            // Online: only host can start; broadcast START_GAME so all clients share config.
            if (!netObj.isHost) {
                const statusEl = document.getElementById('net-status');
                if (statusEl) statusEl.textContent = 'Waiting for host to start...';
                return;
            }

            const allFactions = Object.keys(C.factions || {});
            const playerFactions = {};
            const humanFactions = {};

            playerFactions[netObj.playerId] = localFaction;
            humanFactions[localFaction] = true;

            const otherPlayerIds = (netObj.players || []).filter(id => id !== netObj.playerId);
            let idx = 0;
            otherPlayerIds.forEach(id => {
                while (idx < allFactions.length && (allFactions[idx] === localFaction || humanFactions[allFactions[idx]])) {
                    idx++;
                }
                const fac = allFactions[idx];
                if (!fac) return;
                playerFactions[id] = fac;
                humanFactions[fac] = true;
                idx++;
            });

            const teams = {};
            Object.keys(humanFactions).forEach(f => { teams[f] = playerTeam; });
            const aiFactions = ['enemy1', 'enemy2', 'enemy3', 'enemy4', 'enemy5', 'enemy6'];
            aiFactions.forEach(f => {
                if (!humanFactions[f]) teams[f] = aiTeam;
            });

            netObj.send({
                type: 'GAME_MESSAGE',
                data: {
                    kind: 'START_GAME',
                    config: {
                        aiCount,
                        difficulty,
                        teams,
                        humanFactions,
                        playerFactions,
                        hostId: netObj.playerId
                    }
                }
            });
            return;
        }

        // Offline single-player
        const teams = {};
        teams[localFaction] = playerTeam;
        const aiFactions = ['enemy1', 'enemy2', 'enemy3', 'enemy4', 'enemy5', 'enemy6'];
        for (let i = 0; i < aiCount; i++) {
            const fac = aiFactions[i];
            if (!fac) break;
            teams[fac] = aiTeam;
        }

        const humanFactions = {};
        humanFactions[localFaction] = true;

        window.game = new Game({ aiCount, difficulty, teams, localFaction, humanFactions });

        const menu = document.getElementById('start-menu');
        if (menu) menu.classList.add('hidden');
    };

    const net = {
        socket: null,
        connected: false,
        code: null,
        playerId: null,
        players: [],
        isHost: false,
        onGameMessage: null,
        connect(url) {
            if (this.socket && this.connected) {
                this.updateUI();
                return;
            }
            try {
                const ws = new WebSocket(url);
                this.socket = ws;
                const self = this;
                ws.onopen = function() {
                    self.connected = true;
                    self.updateUI();
                };
                ws.onclose = function() {
                    self.connected = false;
                    self.code = null;
                    self.playerId = null;
                    self.players = [];
                    self.isHost = false;
                    self.updateUI();
                };
                ws.onmessage = function(evt) {
                    let msg;
                    try {
                        msg = JSON.parse(evt.data);
                    } catch (e) {
                        return;
                    }
                    const t = msg.type;
                    if (t === 'LOBBY_CREATED') {
                        self.code = msg.code;
                        self.playerId = msg.playerId;
                        self.isHost = true;
                        self.players = [msg.playerId];
                    } else if (t === 'LOBBY_JOINED') {
                        self.code = msg.code;
                        self.playerId = msg.playerId;
                        self.isHost = false;
                    } else if (t === 'LOBBY_PLAYERS') {
                        self.players = msg.players || [];
                    } else if (t === 'PLAYER_JOINED') {
                        if (!self.players.includes(msg.playerId)) self.players.push(msg.playerId);
                    } else if (t === 'PLAYER_LEFT') {
                        self.players = self.players.filter(id => id !== msg.playerId);
                    } else if (t === 'GAME_MESSAGE') {
                        if (typeof self.onGameMessage === 'function') {
                            self.onGameMessage(msg);
                        }
                    }
                    self.updateUI();
                };
            } catch (e) {
                this.connected = false;
                this.updateUI();
            }
        },
        send(obj) {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
            this.socket.send(JSON.stringify(obj));
        },
        hostLobby() {
            if (!this.socket || !this.connected) return;
            this.send({ type: 'CREATE_LOBBY' });
        },
        joinLobby(code) {
            if (!this.socket || !this.connected) return;
            if (!code) return;
            this.send({ type: 'JOIN_LOBBY', code: code.toUpperCase() });
        },
        updateUI() {
            const statusEl = document.getElementById('net-status');
            const codeEl = document.getElementById('net-code');
            const idEl = document.getElementById('net-player-id');
            const playersEl = document.getElementById('net-players');
            if (statusEl) statusEl.textContent = this.connected ? 'Connected' : 'Offline';
            if (codeEl) codeEl.textContent = this.code || '-';
            if (idEl) idEl.textContent = this.playerId || '-';
            if (playersEl) playersEl.textContent = this.players.length ? this.players.join(', ') : '-';
        }
    };

    net.onGameMessage = function(msg) {
        const data = msg && msg.data ? msg.data : null;
        if (!data) return;
        if (data.kind === 'START_GAME') {
            const cfg = data.config || {};
            const aiCount = cfg.aiCount || 0;
            const difficulty = cfg.difficulty || 3;
            const teams = cfg.teams || {};
            const humanFactions = cfg.humanFactions || {};
            const playerFactions = cfg.playerFactions || {};
            const hostId = cfg.hostId;

            const localFaction = playerFactions[this.playerId] || 'player';
            const isAuthoritative = !!hostId && hostId === this.playerId;

            if (window.game) {
                try { location.reload(); } catch (e) {}
                return;
            }

            window.game = new Game({
                aiCount,
                difficulty,
                teams,
                localFaction,
                humanFactions,
                isNetworked: true,
                isAuthoritative,
                playerId: this.playerId
            });

            const menu = document.getElementById('start-menu');
            if (menu) menu.classList.add('hidden');
        } else {
            if (window.game && typeof window.game.handleNetMessage === 'function') {
                window.game.handleNetMessage(msg);
            }
        }
    };

    window.net = net;

    window.connectNet = function() {
        const urlInput = document.getElementById('net-url-input');
        const url = urlInput ? urlInput.value : 'ws://node24.lunes.host:3361';
        net.connect(url);
    };

    window.netHostLobby = function() {
        net.hostLobby();
    };

    window.netJoinLobby = function() {
        const input = document.getElementById('net-join-code-input');
        const code = input ? input.value.trim() : '';
        net.joinLobby(code);
    };
})();
