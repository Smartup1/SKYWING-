import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
const file = "src/game/cities.ts";
let source = readFileSync(file, "utf8");
const start = source.indexOf("    const slots = volumes.reduce(");
const endMarker = "    this.trackMesh(windows)";
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) {
  console.error("Trecho de janelas não encontrado; nada foi alterado.");
  process.exit(1);
}
const endPos = end + endMarker.length;
const old = source.slice(start, endPos);
if (!old.includes("const winGeo = this.trackGeo(new THREE.BoxGeometry(0.62, 0.82, 0.045))")) {
  console.error("A versão de cities.ts não corresponde ao esperado; nada foi alterado.");
  process.exit(1);
}
const replacement = `    // Janelas nas quatro fachadas.
    const slots = volumes.reduce((acc, v) => {
      if (v.h < 4.5) return acc;
      const floors = Math.min(14, Math.floor(v.h / 4.2));
      const columns = Math.min(4, Math.max(1, Math.floor(v.w / 4)));
      return acc + floors * (columns * 2 + 2);
    }, 0);
    const winGeo = this.trackGeo(new THREE.BoxGeometry(0.62, 0.82, 0.045));
    const windows = new THREE.InstancedMesh(winGeo, this.windowMaterial, Math.max(1, slots));
    windows.renderOrder = 1;
    let wi = 0;

    // Frisos entre andares e pilastras para quebrar as fachadas lisas.
    const bandCapacity = volumes.reduce((sum, v) =>
      sum + (v.h >= 8 ? Math.max(0, Math.min(14, Math.floor(v.h / 4.2)) - 1) * 4 : 0), 0);
    const detailGeo = this.trackGeo(new THREE.BoxGeometry(1, 1, 1));
    const bands = new THREE.InstancedMesh(detailGeo, this.flatMaterial, Math.max(1, bandCapacity));
    let bi = 0;
    const pilasterCapacity = volumes.reduce((sum, v) =>
      sum + (v.h >= 8 ? Math.min(5, Math.max(2, Math.floor(v.w / 5))) * 2 : 0), 0);
    const pilasters = new THREE.InstancedMesh(detailGeo, this.bodyMaterial, Math.max(1, pilasterCapacity));
    let pi = 0;

    for (const v of volumes) {
      if (v.h < 4.5) continue;
      const c = Math.cos(v.rot), s = Math.sin(v.rot);
      const floors = Math.min(14, Math.floor(v.h / 4.2));
      const columns = Math.min(4, Math.max(1, Math.floor(v.w / 4)));
      for (let floor = 0; floor < floors; floor += 1) {
        const y = v.y0 + 2.4 + floor * 4.1;
        for (let slot = 0; slot < columns; slot += 1) {
          const lx = ((slot + 1) / (columns + 1) - 0.5) * v.w;
          const frontZ = -v.d / 2 - 0.04;
          const backZ = v.d / 2 + 0.04;
          windows.setMatrixAt(wi++, composeMatrix(v.x + lx * c + frontZ * s, y, v.z - lx * s + frontZ * c, v.rot));
          windows.setMatrixAt(wi++, composeMatrix(v.x + lx * c + backZ * s, y, v.z - lx * s + backZ * c, v.rot + Math.PI));
        }
        const sideX = v.w / 2 + 0.04;
        const otherX = -v.w / 2 - 0.04;
        windows.setMatrixAt(wi++, composeMatrix(v.x + sideX * c, y, v.z - sideX * s, v.rot + Math.PI / 2));
        windows.setMatrixAt(wi++, composeMatrix(v.x + otherX * c, y, v.z - otherX * s, v.rot - Math.PI / 2));
      }
      if (v.h < 8) continue;
      // Frisos discretos contornando o edifício em cada nível.
      for (let floor = 1; floor < floors; floor += 1) {
        const y = v.y0 + floor * 4.1;
        const frontZ = -v.d / 2 - 0.025, backZ = v.d / 2 + 0.025;
        bands.setMatrixAt(bi++, composeMatrix(v.x, y, v.z + frontZ * c, v.rot, v.w + 0.12, 0.12, 0.1));
        bands.setMatrixAt(bi++, composeMatrix(v.x, y, v.z + backZ * c, v.rot, v.w + 0.12, 0.12, 0.1));
        const sideX = v.w / 2 + 0.025, otherSideX = -v.w / 2 - 0.025;
        bands.setMatrixAt(bi++, composeMatrix(v.x + sideX * c, y, v.z - sideX * s, v.rot, 0.1, 0.12, v.d + 0.12));
        bands.setMatrixAt(bi++, composeMatrix(v.x + otherSideX * c, y, v.z - otherSideX * s, v.rot, 0.1, 0.12, v.d + 0.12));
      }
      // Pilastras verticais na frente e nos fundos.
      const count = Math.min(5, Math.max(2, Math.floor(v.w / 5)));
      for (let col = 0; col < count; col += 1) {
        const lx = ((col + 0.5) / count - 0.5) * v.w;
        const frontZ = -v.d / 2 - 0.035, backZ = v.d / 2 + 0.035;
        pilasters.setMatrixAt(pi++, composeMatrix(v.x + lx * c + frontZ * s, v.y0 + v.h / 2, v.z - lx * s + frontZ * c, v.rot, 0.1, v.h, 0.08));
        pilasters.setMatrixAt(pi++, composeMatrix(v.x + lx * c + backZ * s, v.y0 + v.h / 2, v.z - lx * s + backZ * c, v.rot, 0.1, v.h, 0.08));
      }
    }
    windows.count = wi;
    bands.count = bi;
    pilasters.count = pi;
    this.trackMesh(pitched);
    this.trackMesh(flat);
    this.trackMesh(spireMesh);
    this.trackMesh(antennaMesh);
    this.trackMesh(beaconMesh);
    this.trackMesh(windows);
    this.trackMesh(bands);
    this.trackMesh(pilasters)`;
copyFileSync(file, file + ".antes-predios");
writeFileSync(file, source.slice(0, start) + replacement + source.slice(endPos), "utf8");
console.log("Melhoria aplicada. Backup: src/game/cities.ts.antes-predios");
