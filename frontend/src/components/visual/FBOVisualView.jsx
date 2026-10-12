import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import api from '../../api/client';
import Spinner from '../ui/Spinner';

const BOX_W = 1.05, BOX_D = 1.05, BOX_H = 0.9;
const COLS = 5, ROWS = 5, LAYER_SIZE = COLS * ROWS;
const PALLET_GAP = 8;
const fmtQ = (v) => { const n = parseFloat(v || 0); return Number.isInteger(n) ? String(n) : n.toFixed(0); };

// Label texture cache
const labelCache = new Map();
function getLabelTexture(name, qty) {
  const key = `${name}|${qty}`;
  if (labelCache.has(key)) return labelCache.get(key);
  const lc = document.createElement('canvas');
  lc.width = 128; lc.height = 64;
  const ctx = lc.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#1a1a1a'; ctx.font = 'bold 14px Arial';
  const short = name.length > 14 ? name.slice(0, 13) + '…' : name;
  ctx.fillText(short, 6, 22);
  ctx.font = 'bold 16px Arial'; ctx.fillStyle = '#333';
  ctx.fillText(qty + ' шт', 6, 48);
  const tex = new THREE.CanvasTexture(lc);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 });
  labelCache.set(key, mat);
  return mat;
}

// ─── Build one pallet ──────────────────────────────────────────────────────
function buildPallet(palletData, sharedMats, sharedGeo, offsetX, offsetZ) {
  const pallet = new THREE.Group();
  pallet.position.set(offsetX, 0, offsetZ);
  const boxes = palletData.boxes || [];

  // Wood base — top planks
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(sharedGeo.plank, sharedMats.wood);
    p.position.set(0, 0.35, -2.4 + i * 1.2);
    pallet.add(p);
  }
  // Stringers
  for (let i = -1; i <= 1; i++) {
    const s = new THREE.Mesh(sharedGeo.stringer, sharedMats.woodDark);
    s.position.set(i * 2.2, 0.175, 0);
    pallet.add(s);
  }
  // Bottom planks
  for (let x = -1; x <= 1; x++) {
    const bp = new THREE.Mesh(sharedGeo.bottomPlank, sharedMats.wood);
    bp.position.set(x * 2.2, 0.06, 0);
    pallet.add(bp);
  }

  // Pallet name label on floor
  const nc = document.createElement('canvas');
  nc.width = 512; nc.height = 96;
  const nctx = nc.getContext('2d');
  nctx.fillStyle = '#7c3aed'; nctx.beginPath(); nctx.roundRect(0, 0, 512, 96, 14); nctx.fill();
  nctx.fillStyle = '#fff'; nctx.font = 'bold 40px Arial'; nctx.fillText(palletData.name, 20, 42);
  nctx.font = '26px Arial'; nctx.fillStyle = 'rgba(255,255,255,0.8)';
  const totalQty = boxes.reduce((s, b) => s + parseFloat(b.quantity || 0), 0);
  nctx.fillText(`${boxes.length} кор. · ${fmtQ(totalQty)} шт`, 20, 78);
  const nameTex = new THREE.CanvasTexture(nc); nameTex.anisotropy = 4;
  const nameMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.85), new THREE.MeshBasicMaterial({ map: nameTex, transparent: true }));
  nameMesh.position.set(0, 0.01, 3.6); nameMesh.rotation.x = -Math.PI / 2;
  pallet.add(nameMesh);

  // Boxes
  const boxMeshes = [];
  const layers = Math.ceil(boxes.length / LAYER_SIZE);
  if (layers === 0) {
    pallet.userData = { type: 'pallet', boxMeshes, palletInfo: palletData };
    return pallet;
  }

  for (let li = 0; li < layers; li++) {
    const lg = new THREE.Group();
    const baseY = 0.42 + li * (BOX_H + 0.08);
    const layerBoxes = boxes.slice(li * LAYER_SIZE, (li + 1) * LAYER_SIZE);

    if (li > 0) {
      const board = new THREE.Mesh(sharedGeo.board, sharedMats.boardSep);
      board.position.y = baseY - 0.04;
      lg.add(board);
    }

    layerBoxes.forEach((box, idx) => {
      const row = Math.floor(idx / COLS), col = idx % COLS;
      const g = new THREE.Group();

      const mesh = new THREE.Mesh(sharedGeo.box, [
        sharedMats.boxSide, sharedMats.boxSide,
        sharedMats.boxTop, sharedMats.boxSide,
        sharedMats.boxSide, sharedMats.boxSide,
      ]);
      g.add(mesh);
      g.add(new THREE.Mesh(sharedGeo.tapeV, sharedMats.tape));

      const name = (box.product_name || '—').replace(/GraFLab,?\s*/i, '').trim();
      const qty = fmtQ(box.quantity);
      const labelMat = getLabelTexture(name, qty);
      const label = new THREE.Mesh(sharedGeo.label, labelMat);
      label.position.set(0, -0.1, BOX_D / 2 + 0.005);
      g.add(label);

      g.position.set((col - 2) * (BOX_W + 0.05), baseY + BOX_H / 2, (row - 2) * (BOX_D + 0.05));
      g.userData = {
        type: 'box',
        product: name, qty, barcode: box.barcode_value || '—',
        boxId: box.id, boxData: box,
        palletName: palletData.name, palletId: palletData.id,
        layerIndex: li,
      };

      lg.add(g);
      boxMeshes.push(g);
    });

    pallet.add(lg);
  }

  pallet.userData = { type: 'pallet', boxMeshes, palletInfo: palletData };
  return pallet;
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function FBOVisualView({ warehouse, onSelect }) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const allBoxRef = useRef([]);
  const palletGroupsRef = useRef([]);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get(`/fbo/visual/${warehouse.id}`); setRows(r.data.rows || []); }
    catch {} finally { setLoading(false); }
  }, [warehouse.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (loading || !containerRef.current || rows.length === 0) return;
    const el = containerRef.current;
    const W = el.clientWidth, H = Math.max(500, window.innerHeight - 260);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xfaf9f7);

    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = false;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'border-radius:12px;overflow:hidden;';
    wrapper.appendChild(renderer.domElement);
    el.innerHTML = '';
    el.appendChild(wrapper);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.1;

    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(10, 20, 8);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-10, 15, -5);
    scene.add(fillLight);

    const totalZ = Math.max(0, (rows.length - 1) * 12);
    const floorSize = Math.max(120, totalZ + 40);
    const floorCenterZ = totalZ / 2;

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorSize, floorSize),
      new THREE.MeshStandardMaterial({ color: 0xf5f3ef, roughness: 0.8 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, floorCenterZ);
    scene.add(floor);

    const grid = new THREE.GridHelper(floorSize, Math.floor(floorSize / 2), 0xe0ddd6, 0xe0ddd6);
    grid.position.set(0, 0.01, floorCenterZ);
    grid.material.opacity = 0.35;
    grid.material.transparent = true;
    scene.add(grid);

    const mats = {
      wood: new THREE.MeshStandardMaterial({ color: 0xd4a84a, roughness: 0.6 }),
      woodDark: new THREE.MeshStandardMaterial({ color: 0x9a7530, roughness: 0.7 }),
      boxSide: new THREE.MeshStandardMaterial({ color: 0xf0e6d0, roughness: 0.5 }),
      boxTop: new THREE.MeshStandardMaterial({ color: 0xf7eed8, roughness: 0.4 }),
      tape: new THREE.MeshStandardMaterial({ color: 0xd4c8a8, roughness: 0.4, transparent: true, opacity: 0.45 }),
      boardSep: new THREE.MeshStandardMaterial({ color: 0xd4a84a, roughness: 0.6 }),
    };

    const geo = {
      plank: new THREE.BoxGeometry(6, 0.15, 0.8),
      stringer: new THREE.BoxGeometry(0.6, 0.35, 5.6),
      bottomPlank: new THREE.BoxGeometry(0.8, 0.12, 5.6),
      box: new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D),
      tapeV: new THREE.BoxGeometry(0.08, BOX_H + 0.01, BOX_D + 0.01),
      board: new THREE.BoxGeometry(5.8, 0.06, 5.8),
      label: new THREE.PlaneGeometry(0.6, 0.3),
    };

    const allBoxMeshes = [];
    const palletGroups = [];
    rows.forEach((row, ri) => {
      row.pallets.forEach((p, pi) => {
        const x = pi * PALLET_GAP - ((row.pallets.length - 1) * PALLET_GAP) / 2;
        const z = ri * 12;
        const pg = buildPallet(p, mats, geo, x, z);
        scene.add(pg);
        allBoxMeshes.push(...(pg.userData.boxMeshes || []));
        palletGroups.push(pg);
      });
    });
    allBoxRef.current = allBoxMeshes;
    palletGroupsRef.current = palletGroups;

    controls.target.set(0, 3, floorCenterZ);
    camera.position.set(20, 20, floorCenterZ + 22);

    // Tooltip
    const tooltip = document.createElement('div');
    tooltip.style.cssText = 'position:fixed;display:none;z-index:100;background:#1c1917;color:white;padding:8px 14px;border-radius:10px;font-size:12px;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,0.3);font-family:Inter,Arial,sans-serif;';
    el.appendChild(tooltip);

    // Raycaster — throttled
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let hovered = null;
    let lastRaycast = 0;

    // Find box or pallet from hit
    const findTarget = (hits) => {
      for (const hit of hits) {
        let obj = hit.object;
        while (obj.parent && !obj.userData.type) obj = obj.parent;
        if (obj.userData.type === 'box') return { type: 'box', obj };
        // If hit pallet wood parts, find parent pallet group
        if (obj.userData.type === 'pallet') return { type: 'pallet', obj };
      }
      // Check if any hit is inside a pallet group
      for (const hit of hits) {
        let obj = hit.object;
        while (obj.parent) {
          if (obj.userData.type === 'pallet') return { type: 'pallet', obj };
          obj = obj.parent;
        }
      }
      return null;
    };

    const onMove = (e) => {
      const now = performance.now();
      if (now - lastRaycast < 32) return;
      lastRaycast = now;

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      const target = findTarget(hits);

      if (target && target.type === 'box') {
        const obj = target.obj;
        if (hovered !== obj) { if (hovered) hovered.scale.set(1, 1, 1); hovered = obj; obj.scale.set(1.08, 1.08, 1.08); }
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX + 16) + 'px';
        tooltip.style.top = (e.clientY - 10) + 'px';
        tooltip.innerHTML = `<b>${obj.userData.product}</b><br>ШК: ${obj.userData.barcode} · ${obj.userData.qty} шт<br><span style="opacity:0.6">Клик → карточка</span>`;
        renderer.domElement.style.cursor = 'pointer';
        return;
      }
      if (target && target.type === 'pallet') {
        const info = target.obj.userData.palletInfo;
        if (hovered) { hovered.scale.set(1, 1, 1); hovered = null; }
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX + 16) + 'px';
        tooltip.style.top = (e.clientY - 10) + 'px';
        const totalQty = (info.boxes || []).reduce((s, b) => s + parseFloat(b.quantity || 0), 0);
        tooltip.innerHTML = `<b>${info.name}</b><br>${(info.boxes || []).length} кор. · ${fmtQ(totalQty)} шт<br><span style="opacity:0.6">Клик → карточка</span>`;
        renderer.domElement.style.cursor = 'pointer';
        return;
      }

      if (hovered) { hovered.scale.set(1, 1, 1); hovered = null; }
      tooltip.style.display = 'none';
      renderer.domElement.style.cursor = 'grab';
    };
    renderer.domElement.addEventListener('mousemove', onMove);

    // Click handler
    const onClick = (e) => {
      if (!onSelect) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      const target = findTarget(hits);
      if (!target) { onSelect(null); return; }

      if (target.type === 'box') {
        const d = target.obj.userData;
        onSelect({ type: 'box', boxId: d.boxId, boxData: d.boxData, product: d.product, qty: d.qty, barcode: d.barcode, palletId: d.palletId, palletName: d.palletName });
      } else if (target.type === 'pallet') {
        const info = target.obj.userData.palletInfo;
        onSelect({ type: 'pallet', palletId: info.id, palletName: info.name, palletData: info, boxes: info.boxes || [] });
      }
    };
    renderer.domElement.addEventListener('click', onClick);

    // Resize
    const onResize = () => {
      const w = el.clientWidth, h = Math.max(500, window.innerHeight - 260);
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    let animId;
    const animate = () => { animId = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('mousemove', onMove);
      renderer.domElement.removeEventListener('click', onClick);
      controls.dispose();
      Object.values(geo).forEach(g => g.dispose());
      Object.values(mats).forEach(m => m.dispose());
      renderer.dispose();
      el.innerHTML = '';
    };
  }, [loading, rows, onSelect]);

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}><Spinner size="lg" /></div>;

  return (
    <div ref={containerRef} style={{ width: '100%', position: 'relative' }}>
      {rows.length === 0 && <div style={{ textAlign: 'center', padding: 80, color: '#bbb' }}>Нет данных</div>}
      <p style={{ textAlign: 'center', fontSize: 11, color: '#bbb', marginTop: 6 }}>
        Крути мышкой · Скролл = зум · ПКМ = панорама
      </p>
    </div>
  );
}
