(function() {
    const GameAI = {
        updateAI: function() {
            const game = this;
            if (!game || !game.queens || !game.entities) return;
            const frame = game.frameCount || 0;
            if (frame % 20 !== 0) return;

            const diff = Math.max(1, Math.min(10, game.difficulty || 3));
            const isHumanFaction = function(fac) {
                return !!(game.humanFactions && game.humanFactions[fac]);
            };

            game.queens.forEach(q => {
                if (!q || q.markedForDeletion) return;
                const fac = q.faction;
                if (isHumanFaction(fac)) return;
                const res = q.resources;
                if (!res) return;

                let workers = 0;
                let soldiers = 0;
                let elites = 0;
                let anthills = 0;

                game.entities.forEach(e => {
                    if (!e || e.markedForDeletion || e.faction !== fac) return;
                    if (e instanceof Ant) {
                        if (e.type === 'worker') workers++;
                        else if (e.type === 'soldier') soldiers++;
                        else if (e.type === 'elite') elites++;
                    } else if (e instanceof Building && e.type === 'anthill') {
                        anthills++;
                    }
                });

                const totalArmyBase = soldiers + elites;
                const maxArmy = 12 + diff * 18;

                let underAttack = false;
                const myTeam = game.getTeam ? game.getTeam(fac) : null;
                game.entities.forEach(e => {
                    if (!e || e.markedForDeletion) return;
                    if (!(e instanceof Ant || e instanceof Queen)) return;
                    if (!e.faction || e.faction === fac) return;
                    const otherTeam = game.getTeam ? game.getTeam(e.faction) : null;
                    if (myTeam != null && otherTeam != null && otherTeam === myTeam) return;
                    const dQ = q.pos.dist(e.pos);
                    if (dQ < 260) {
                        underAttack = true;
                    }
                });

                let totalArmy = totalArmyBase;

                if (underAttack) {
                    const panicCostSoldier = C.costs.soldier;
                    while (
                        q.resources.food >= panicCostSoldier.food &&
                        q.resources.wood >= panicCostSoldier.wood &&
                        q.resources.stone >= panicCostSoldier.stone &&
                        totalArmy < maxArmy
                    ) {
                        game.spawnAnt("soldier", fac);
                        totalArmy++;
                    }
                    return;
                }

                const desiredAnthills = Math.min(5, 1 + Math.floor(diff / 2));
                const costAnthill = 500;

                if (res.wood >= costAnthill && anthills < desiredAnthills) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 90 + Math.random() * 90;
                    const x = q.pos.x + Math.cos(angle) * dist;
                    const y = q.pos.y + Math.sin(angle) * dist;
                    game.spawnBuilding(x, y, fac, "anthill");
                }

                const minWorkers = 6 + diff * 2;
                if (workers < minWorkers) {
                    const costWorker = C.costs.worker;
                    if (res.food >= costWorker.food && res.wood >= costWorker.wood && res.stone >= costWorker.stone) {
                        game.spawnAnt("worker", fac);
                        return;
                    }
                }

                if (totalArmy >= maxArmy) return;

                const costSoldier = C.costs.soldier;
                const costElite = C.costs.elite;

                const canElite = res.food >= costElite.food && res.wood >= costElite.wood && res.stone >= costElite.stone;
                const canSoldier = res.food >= costSoldier.food && res.wood >= costSoldier.wood && res.stone >= costSoldier.stone;

                if (diff >= 6 && canElite && Math.random() < 0.3) {
                    game.spawnAnt("elite", fac);
                } else if (canSoldier) {
                    game.spawnAnt("soldier", fac);
                }

                if (!game.aiScout) game.aiScout = {};
                if (!game.aiScout[fac] && totalArmy > 10) {
                    game.aiScout[fac] = true;
                }
            });
        }
    };

    window.GameAI = GameAI;
})();
