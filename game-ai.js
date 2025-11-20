// AI module for Ant Empire: Age of Stone
//
// Responsibilities:
// - Encapsulate AI behavior for non-human factions
// - Production (workers/soldiers/elites)
// - Strategic building (anthills)
// - Scout mode and coordinated attack waves
//
// This module attaches a single function `updateAI` to the global GameAI
// namespace. The main Game class delegates to this module via
// `GameAI.updateAI.call(gameInstance)`.

(function() {
    const GameAI = window.GameAI || (window.GameAI = {});

    /**
     * Runs AI logic for all non-human factions.
     *
     * This function is intended to be called from `Game.update()` on the
     * authoritative host. It assumes `this` is a `Game` instance.
     */
    GameAI.updateAI = function() {
        // BEGIN: Original Game.updateAI body (refactored out of game-core.js)
        // AI Logic for Enemy Factions
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
            const hasAnthill = myBuildings.some(b => b.type === 'anthill');

            // Target composition scales with difficulty
            const targetWorkers  = 12 + diff * 3;               // heavier eco at higher diff
            const targetSoldiers = 4 + Math.floor(diff * 3);    // much bigger armies
            const targetElites   = Math.floor(diff / 1.5);      // more elites on high diff

            // 1. Production Logic: try to reach target composition
            if (workers < targetWorkers && r.food >= C.costs.worker.food) {
                // When very poor, only build workers
                this.spawnAnt('worker', q.faction);
            } else if (hasAnthill && soldiers < targetSoldiers && r.food >= C.costs.soldier.food && r.wood >= C.costs.soldier.wood) {
                this.spawnAnt('soldier', q.faction);
                // If very rich, build an extra soldier in the same tick
                if (hasAnthill && r.food > 4 * C.costs.soldier.food && r.wood > 4 * C.costs.soldier.wood && diff >= 7) {
                    this.spawnAnt('soldier', q.faction);
                }
            } else if (hasAnthill && elites < targetElites && r.food >= C.costs.elite.food && r.wood >= C.costs.elite.wood && r.stone >= C.costs.elite.stone) {
                this.spawnAnt('elite', q.faction);
            } else if (hasAnthill && diff >= 7 && r.food > 3 * C.costs.soldier.food && r.wood > 3 * C.costs.soldier.wood) {
                // On very hard, dump excess into extra soldiers when rich
                this.spawnAnt('soldier', q.faction);
            }

            // 1b. Strategic buildings: AI builds anthills based on difficulty
            const maxAnthills = 1 + Math.floor(diff / 3); // diff 1-3: 1-2, diff 10: up to 4
            const needFirstAnthill = myBuildings.length === 0;
            const needMoreAnthills = myBuildings.length < maxAnthills;

            if (needFirstAnthill) {
                if (r.wood < 500) r.wood = 500;
                const offsetX = (Math.random()-0.5) * 80;
                const offsetY = (Math.random()-0.5) * 80;
                this.spawnBuilding(q.pos.x + offsetX, q.pos.y + offsetY, q.faction, 'anthill');
            } else if (needMoreAnthills && r.wood >= 500) {
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

            // 3. Coordinated attack waves toward any enemy-team queen (all human players on enemy teams)
            //    Do not allow waves in the first ~20 seconds to give the players a grace period.
            const qTeam = this.getTeam(q.faction);
            const enemyQueens = this.queens.filter(qq => {
                if (qq.markedForDeletion) return false;
                const tTeam = this.getTeam(qq.faction);
                return tTeam != null && qTeam != null && tTeam !== qTeam;
            });

            // Choose the closest enemy queen as the focal target for this AI queen's wave
            let globalTargetQueen = null;
            if (enemyQueens.length > 0) {
                globalTargetQueen = enemyQueens.reduce((best, cand) => {
                    if (!best) return cand;
                    const dBest = best.pos.dist(q.pos);
                    const dCand = cand.pos.dist(q.pos);
                    return dCand < dBest ? cand : best;
                }, null);
            }

            if (globalTargetQueen && this.frameCount >= 20 * 60 && this.frameCount % waveInterval === 0) {
                const combatAnts = myAnts.filter(a => a.type !== 'worker');
                const required = baseWaveSize + diff; // higher difficulty = bigger waves
                if (combatAnts.length >= required) {
                    // All combat ants of this AI queen focus the chosen enemy queen
                    combatAnts.forEach(a => {
                        a.manualCommand = true;
                        a.target = globalTargetQueen;
                        a.state = 'ATTACK';
                    });
                }
            }
        });
        // END: Original Game.updateAI body
    };
})();
